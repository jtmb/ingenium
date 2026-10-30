/* ROOT-OPERATED QUALIFICATION ONLY. No production grant is created here.
 * Build/run only under Root's registered stage/build/resource lease.
 * Creates ONE fresh root-owned cgroup below an already-enabled cgroup2 parent.
 * No controller toggles, existing workload migration, shell, daemon or fallback.
 * The exact fresh child is gated before interpreter exec and drops root first.
 */
#define _GNU_SOURCE
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/statfs.h>
#include <sys/wait.h>
#include <sys/syscall.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/mount.h>
#include <linux/magic.h>
#include <linux/capability.h>
#include <unistd.h>
#include <fcntl.h>
#include <signal.h>
#include <grp.h>
#include <poll.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <limits.h>
#include <sched.h>
#ifndef VEYRA_QUALIFICATION_ROOT
#error "Root must compile with its exact registered qualification output prefix"
#endif

static volatile sig_atomic_t cancelled;
static int retained_killer=-1,retained_leaf=-1,retained_parent=-1,retained_waited=0,retained_pidfd=-1;
static pid_t retained_child;
static char retained_name[96];
static struct stat retained_identity;
static void cancel_run(int sig) { (void)sig; cancelled=1; }
static void fatal(const char *message) {
  fprintf(stderr,"qualification refused: %s; original remains retained until cleanup\n",message);
  if(retained_child){
    if(retained_killer<0||write(retained_killer,"1",1)!=1){fprintf(stderr,"owned kill refused; retain owner/leaf\n");for(;;)pause();}
    if(!retained_waited){
      /* The fresh gate may have failed before cgroup placement. This is our
       * exact unreaped fork, never a discovered/replayed PID. */
      if(retained_pidfd>=0)syscall(SYS_pidfd_send_signal,retained_pidfd,SIGKILL,NULL,0);
      else kill(retained_child,SIGKILL);
    }
    if(!retained_waited)while(waitpid(retained_child,NULL,0)<0){if(errno!=EINTR){fprintf(stderr,"original wait unknown; retain owner/leaf\n");for(;;)pause();}}
    retained_waited=1;
  }
  if(retained_leaf>=0){
    char data[512];for(;;){int fd=openat(retained_leaf,"cgroup.events",O_RDONLY|O_NOFOLLOW|O_CLOEXEC);
      ssize_t n=fd<0?-1:read(fd,data,sizeof data-1);if(fd>=0)close(fd);if(n>0){data[n]=0;if(strstr(data,"populated 0\n"))break;}usleep(10000);}
    struct stat actual,named;
    if(fstat(retained_leaf,&actual)||fstatat(retained_parent,retained_name,&named,AT_SYMLINK_NOFOLLOW)||actual.st_ino!=retained_identity.st_ino||actual.st_dev!=retained_identity.st_dev||named.st_ino!=actual.st_ino){fprintf(stderr,"leaf custody failed; retained exact original\n");exit(70);}
    close(retained_leaf);retained_leaf=-1;
    if(unlinkat(retained_parent,retained_name,AT_REMOVEDIR))fprintf(stderr,"empty exact owned leaf retained: %s\n",retained_name);
  }
  exit(70);
}
static uint64_t number(const char *value) {
  if(!*value || strspn(value,"0123456789")!=strlen(value)) fatal("integer input");
  errno=0; char *end; unsigned long long result=strtoull(value,&end,10);
  if(errno||*end||result>9007199254740991ULL) fatal("integer range"); return result;
}
static uint64_t now_ms(void) { struct timespec t; if(clock_gettime(CLOCK_MONOTONIC,&t))fatal("monotonic clock");return (uint64_t)t.tv_sec*1000+t.tv_nsec/1000000; }
static void text_at(int directory,const char *name,char *out,size_t size) {
  int fd=openat(directory,name,O_RDONLY|O_NOFOLLOW|O_CLOEXEC); if(fd<0)fatal("kernel fact open");
  ssize_t n=read(fd,out,size-1); if(n<0||(size_t)n==size-1)fatal("kernel fact bound");out[n]=0;close(fd);
}
static void write_at(int directory,const char *name,const char *value) {
  int fd=openat(directory,name,O_WRONLY|O_NOFOLLOW|O_CLOEXEC);if(fd<0)fatal("owned limit open");
  size_t length=strlen(value);if(write(fd,value,length)!=(ssize_t)length)fatal("owned limit write");close(fd);
}
static void limit_at(int directory,const char *name,const char *value) {
  char actual[256];write_at(directory,name,value);text_at(directory,name,actual,sizeof actual);
  actual[strcspn(actual,"\n")]=0;if(strcmp(actual,value))fatal("owned limit readback");
}
static int empty(int leaf) { char value[1024];text_at(leaf,"cgroup.events",value,sizeof value);return strstr(value,"populated 0\n")!=NULL; }
static int contains(const char *list,const char *word) {
  char copy[1024];if(strlen(list)>=sizeof copy)fatal("controllers bound");strcpy(copy,list);
  char *state=NULL;for(char *p=strtok_r(copy," \n",&state);p;p=strtok_r(NULL," \n",&state))if(!strcmp(p,word))return 1;return 0;
}
static void uuid(const char *value) {
  if(strlen(value)!=36)fatal("run UUID");int nonzero=0;
  for(int i=0;i<36;i++){if(i==8||i==13||i==18||i==23){if(value[i]!='-')fatal("run UUID");}
    else{if(!strchr("0123456789abcdef",value[i]))fatal("run UUID");if(value[i]!='0')nonzero=1;}}
  if(!nonzero)fatal("nil UUID");
}
static uint64_t child_start(pid_t pid) {
  char path[64],value[4096];snprintf(path,sizeof path,"/proc/%ld/stat",(long)pid);
  int fd=open(path,O_RDONLY|O_CLOEXEC);if(fd<0)fatal("actual child stat");ssize_t n=read(fd,value,sizeof value-1);close(fd);
  if(n<0||(size_t)n==sizeof value-1)fatal("actual child stat bound");value[n]=0;
  char *end=strrchr(value,')');if(!end||end[1]!=' ')fatal("actual child stat shape");
  char *state=NULL,*part=strtok_r(end+2," ",&state);for(int field=3;part;field++,part=strtok_r(NULL," ",&state))if(field==22)return number(part);
  fatal("actual child start identity");return 0;
}
static void membership(pid_t pid,const char *leaf) {
  char path[64],expected[128],actual[1024];snprintf(path,sizeof path,"/proc/%ld/cgroup",(long)pid);
  int fd=open(path,O_RDONLY|O_CLOEXEC);if(fd<0)fatal("child membership open");ssize_t n=read(fd,actual,sizeof actual-1);close(fd);
  if(n<0||(size_t)n==sizeof actual-1)fatal("child membership bound");actual[n]=0;
  snprintf(expected,sizeof expected,"0::/%s\n",leaf);if(strcmp(actual,expected))fatal("actual child membership mismatch");
}
static void drain(int descriptor,int *eof,int destination,size_t *count) {
  char bytes[4096];for(;;){ssize_t n=read(descriptor,bytes,sizeof bytes);if(n==0){*eof=1;return;}
    if(n<0){if(errno==EAGAIN||errno==EINTR)return;fatal("original pipe read");}
    *count+=(size_t)n;if(*count>65536)cancelled=1;
    if(*count<=65536&&write(destination,bytes,(size_t)n)!=n)fatal("evidence pipe write");}
}
int main(int argc,char **argv) {
  /* UUID memoryBytes pids quotaUsec periodUsec timeoutMs uid gid TMPDIR -- exe args */
  if(argc<12||strcmp(argv[10],"--"))fatal("arguments");
  if(geteuid()!=0)fatal("Root qualification authority required");uuid(argv[1]);
  pid_t original_parent=getppid();
  signal(SIGTERM,cancel_run);signal(SIGINT,cancel_run);signal(SIGHUP,cancel_run);signal(SIGPIPE,SIG_IGN);
  if(prctl(PR_SET_PDEATHSIG,SIGTERM)||getppid()!=original_parent)fatal("actual coordinator parent changed before qualification");
  /* A paused reader must not block the owner and suppress its deadline. Output
   * refusal cancels this original and refuses qualification, never drains it. */
  if(fcntl(1,F_SETFL,fcntl(1,F_GETFL)|O_NONBLOCK)<0||fcntl(2,F_SETFL,fcntl(2,F_GETFL)|O_NONBLOCK)<0)fatal("nonblocking original evidence outputs");
  uint64_t memory=number(argv[2]),pids=number(argv[3]),quota=number(argv[4]),period=number(argv[5]),duration=number(argv[6]);
  if(number(argv[7])>UINT_MAX||number(argv[8])>UINT_MAX)fatal("identity range");
  uid_t uid=(uid_t)number(argv[7]);gid_t gid=(gid_t)number(argv[8]);
  if(memory<268435456||!pids||!quota||period<1000||period>1000000||duration<1||duration>1800000||uid==0||gid==0||argv[9][0]!='/'||argv[11][0]!='/')fatal("bounded operator envelope required");
  const char *reserve_text=getenv("VEYRA_QUAL_HOST_RESERVE_BYTES");if(!reserve_text)fatal("explicit operator host reserve required");
  uint64_t host_reserve=number(reserve_text);if(!host_reserve)fatal("positive operator host reserve required");
  const char *readonly_text=getenv("VEYRA_QUAL_READONLY_PATHS");
  if(!readonly_text||!*readonly_text||strlen(readonly_text)>65535)fatal("exact readonly input mounts required");
  FILE *meminfo=fopen("/proc/meminfo","re");char memline[256];uint64_t available=0;
  if(!meminfo)fatal("host memory facts");while(fgets(memline,sizeof memline,meminfo)){unsigned long long kb;if(sscanf(memline,"MemAvailable: %llu kB",&kb)==1)available=kb*1024;}fclose(meminfo);
  if(!available||memory>available||host_reserve>available-memory)fatal("actual host headroom below qualification envelope");
  const char *root=VEYRA_QUALIFICATION_ROOT;
  if(strncmp(argv[9],root,strlen(root))||strstr(argv[9],"/../")||strstr(argv[9],"/./"))fatal("registered task scratch required");
  int parent=open("/sys/fs/cgroup",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(parent<0)fatal("fixed cgroup parent");
  int bootdir=open("/proc/sys/kernel/random",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);char boot[128];
  if(bootdir<0)fatal("kernel boot identity");text_at(bootdir,"boot_id",boot,sizeof boot);close(bootdir);boot[strcspn(boot,"\n")]=0;uuid(boot);
  int ns=open("/proc/self/ns/cgroup",O_RDONLY|O_CLOEXEC);struct stat ns_before;
  if(ns<0||fstat(ns,&ns_before))fatal("original cgroup namespace");
  struct statfs fs;struct stat parent_info;if(fstatfs(parent,&fs)||fs.f_type!=CGROUP2_SUPER_MAGIC||fstat(parent,&parent_info)||parent_info.st_uid!=0||(parent_info.st_mode&0022))fatal("cgroup parent custody");
  char controllers[1024];text_at(parent,"cgroup.subtree_control",controllers,sizeof controllers);
  if(!contains(controllers,"memory")||!contains(controllers,"cpu")||!contains(controllers,"pids"))fatal("existing controllers unavailable; no policy toggle");
  char name[96];snprintf(name,sizeof name,"veyra-cpu-qualification-%s",argv[1]);
  if(mkdirat(parent,name,0755))fatal("fresh owned leaf creation failed; never adopt");
  int leaf=openat(parent,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(leaf<0)fatal("new leaf open");
  struct stat original;if(fstat(leaf,&original)||original.st_uid!=0||!empty(leaf))fatal("new leaf identity");
  retained_leaf=leaf;retained_parent=parent;retained_identity=original;strcpy(retained_name,name);
  char value[128];snprintf(value,sizeof value,"%llu",(unsigned long long)memory);limit_at(leaf,"memory.max",value);
  limit_at(leaf,"memory.swap.max","0");limit_at(leaf,"memory.oom.group","1");
  snprintf(value,sizeof value,"%llu",(unsigned long long)pids);limit_at(leaf,"pids.max",value);
  snprintf(value,sizeof value,"%llu %llu",(unsigned long long)quota,(unsigned long long)period);limit_at(leaf,"cpu.max",value);
  int killer=openat(leaf,"cgroup.kill",O_WRONLY|O_NOFOLLOW|O_CLOEXEC);if(killer<0)fatal("original group kill capability");
  retained_killer=killer;
  int executable=open(argv[11],O_RDONLY|O_NOFOLLOW|O_CLOEXEC);struct stat executable_info;
  if(executable<0||fstat(executable,&executable_info)||!S_ISREG(executable_info.st_mode)||(executable_info.st_mode&0022))fatal("approved interpreter custody");
  int gate[2],ready[2],output[2],errors[2];if(pipe2(gate,O_CLOEXEC)||pipe2(ready,O_CLOEXEC)||pipe2(output,O_CLOEXEC)||pipe2(errors,O_CLOEXEC))fatal("original pipes");
  uint64_t deadline=now_ms()+duration;pid_t child=fork();if(child<0)fatal("original fork");
  if(child==0){
    close(gate[1]);close(ready[0]);char flag='R';if(write(ready[1],&flag,1)!=1)_exit(71);
    if(read(gate[0],&flag,1)!=1||flag!='A')_exit(72);close(gate[0]);close(ready[1]);
    if(dup2(output[1],1)<0||dup2(errors[1],2)<0)_exit(73);
    int null=open("/dev/null",O_RDONLY|O_CLOEXEC);if(null<0||dup2(null,0)<0)_exit(73);
    int image=fcntl(executable,F_DUPFD_CLOEXEC,3);if(image<0)_exit(73);
    if(image!=3){if(dup3(image,3,O_CLOEXEC)<0)_exit(73);close(image);}
    if(syscall(SYS_close_range,4U,~0U,0U))_exit(73);
    /* Mount changes are confined to THIS fresh child namespace. External
     * Stratus/base files and host mount/controller policy are never modified. */
    if(unshare(CLONE_NEWNS)||mount(NULL,"/",NULL,MS_REC|MS_PRIVATE,NULL))_exit(74);
    char mounts[65536];strcpy(mounts,readonly_text);char *mount_state=NULL;unsigned mount_count=0;
    for(char *path=strtok_r(mounts,"\n",&mount_state);path;path=strtok_r(NULL,"\n",&mount_state)){
      struct stat facts;if(++mount_count>16||path[0]!='/'||!strcmp(path,"/")||lstat(path,&facts)||!S_ISDIR(facts.st_mode)||S_ISLNK(facts.st_mode))_exit(74);
      if(mount(path,path,NULL,MS_BIND|MS_REC,NULL)||mount(NULL,path,NULL,MS_BIND|MS_REMOUNT|MS_RDONLY|MS_NOSUID|MS_NODEV,NULL))_exit(74);
    }
    if(setgroups(0,NULL)||setresgid(gid,gid,gid)||setresuid(uid,uid,uid)||prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0))_exit(74);
    struct __user_cap_header_struct header={_LINUX_CAPABILITY_VERSION_3,0};struct __user_cap_data_struct caps[2]={{0},{0}};
    if(syscall(SYS_capset,&header,caps))_exit(74);
    clearenv();setenv("PATH","/usr/bin:/bin",1);setenv("TMPDIR",argv[9],1);setenv("TMP",argv[9],1);setenv("TEMP",argv[9],1);
    setenv("HOME",argv[9],1);setenv("XDG_CACHE_HOME",argv[9],1);setenv("HF_HOME",argv[9],1);setenv("HF_HUB_OFFLINE","1",1);setenv("TRANSFORMERS_OFFLINE","1",1);
    setenv("TORCH_HOME",argv[9],1);setenv("HUGGINGFACE_HUB_CACHE",argv[9],1);setenv("TRANSFORMERS_CACHE",argv[9],1);
    setenv("PIP_CONFIG_FILE","/dev/null",1);setenv("PIP_CACHE_DIR",argv[9],1);setenv("PIP_DISABLE_PIP_VERSION_CHECK","1",1);
    setenv("PYTHONDONTWRITEBYTECODE","1",1);setenv("CUDA_VISIBLE_DEVICES","",1);setenv("HIP_VISIBLE_DEVICES","",1);setenv("ROCR_VISIBLE_DEVICES","",1);
    extern char **environ;fexecve(3,&argv[11],environ);_exit(75);
  }
  close(gate[0]);close(ready[1]);close(output[1]);close(errors[1]);
  retained_child=child;
  int pidfd=(int)syscall(SYS_pidfd_open,child,0);if(pidfd<0){kill(child,SIGKILL);waitpid(child,NULL,0);retained_waited=1;fatal("original pidfd unavailable; interpreter not admitted");}
  retained_pidfd=pidfd;
  uint64_t started=child_start(child);snprintf(value,sizeof value,"%ld",(long)child);write_at(leaf,"cgroup.procs",value);membership(child,name);
  uint64_t current_time=now_ms(),remaining=deadline>current_time?deadline-current_time:0;
  struct pollfd ready_poll={ready[0],POLLIN,0};if(poll(&ready_poll,1,(int)(remaining>5000?5000:remaining))!=1){cancelled=1;}char flag;
  if(!cancelled&&(read(ready[0],&flag,1)!=1||flag!='R'))cancelled=1;close(ready[0]);
  if(!cancelled&&(child_start(child)!=started||now_ms()>=deadline))cancelled=1;
  if(!cancelled){flag='A';if(write(gate[1],&flag,1)!=1)cancelled=1;}close(gate[1]);
  fcntl(output[0],F_SETFL,O_NONBLOCK);fcntl(errors[0],F_SETFL,O_NONBLOCK);
  int status=0,waited=0,out_eof=0,err_eof=0,killed=0;size_t out_bytes=0,err_bytes=0;struct rusage usage;memset(&usage,0,sizeof usage);
  while(!waited||!empty(leaf)||!out_eof||!err_eof){
    if((cancelled||now_ms()>=deadline)&&!killed){if(write(killer,"1",1)!=1)fatal("owned kill refused; retain original");killed=1;}
    if(!waited){pid_t result=wait4(child,&status,WNOHANG,&usage);if(result==child){waited=1;retained_waited=1;}else if(result<0)fatal("original wait failed");}
    drain(output[0],&out_eof,1,&out_bytes);drain(errors[0],&err_eof,2,&err_bytes);
    struct pollfd watch[3]={{waited?-1:pidfd,POLLIN,0},{out_eof?-1:output[0],POLLIN,0},{err_eof?-1:errors[0],POLLIN,0}};poll(watch,3,10);
    /* Deadline requests kill; it never supplies retirement. Keep originals on
     * an uninterruptible kernel stall, even after the qualification deadline. */
  }
  struct stat retained,named;if(fstat(leaf,&retained)||fstatat(parent,name,&named,AT_SYMLINK_NOFOLLOW)||retained.st_dev!=original.st_dev||retained.st_ino!=original.st_ino||named.st_ino!=original.st_ino||!empty(leaf))fatal("original cgroup identity changed");
  struct stat ns_after;if(fstat(ns,&ns_after)||ns_after.st_ino!=ns_before.st_ino||ns_after.st_dev!=ns_before.st_dev)fatal("namespace identity changed");
  char memory_peak[128],pids_peak[128],cpu_stat[1024],mem_events[1024],pid_events[1024];text_at(leaf,"memory.peak",memory_peak,sizeof memory_peak);text_at(leaf,"pids.peak",pids_peak,sizeof pids_peak);
  text_at(leaf,"cpu.stat",cpu_stat,sizeof cpu_stat);text_at(leaf,"memory.events",mem_events,sizeof mem_events);text_at(leaf,"pids.events",pid_events,sizeof pid_events);
  /* Raw counters are preserved before deleting the exact empty leaf. */
  fprintf(stderr,"\nqualification-cpu.stat\n%squalification-memory.events\n%squalification-pids.events\n%s",cpu_stat,mem_events,pid_events);
  memory_peak[strcspn(memory_peak,"\n")]=0;pids_peak[strcspn(pids_peak,"\n")]=0;
  uint64_t peak=number(memory_peak),tasks=number(pids_peak);
  close(output[0]);close(errors[0]);close(pidfd);close(executable);close(killer);close(leaf);close(ns);
  retained_leaf=-1;retained_killer=-1;
  if(unlinkat(parent,name,AT_REMOVEDIR)){fprintf(stderr,"empty original leaf cleanup failed; retain %s; no retry\n",name);return 70;}close(parent);
  fprintf(stderr,"\n{\"qualificationKernelOwner\":1,\"runId\":\"%s\",\"bootId\":\"%s\",\"namespaceInode\":%llu,\"device\":%llu,\"inode\":%llu,\"childStartTicks\":%llu,\"memoryPeakBytes\":%llu,\"leaderMaxRssBytes\":%llu,\"pidsPeak\":%llu,\"memoryMaxBytes\":%llu,\"pidsMax\":%llu,\"cpuQuotaUsec\":%llu,\"cpuPeriodUsec\":%llu,\"waited\":true,\"populated\":false,\"stdoutEOF\":true,\"stderrEOF\":true,\"leafRemoved\":true,\"deadlineKilled\":%s}\n",argv[1],boot,(unsigned long long)ns_before.st_ino,(unsigned long long)original.st_dev,(unsigned long long)original.st_ino,(unsigned long long)started,(unsigned long long)peak,(unsigned long long)usage.ru_maxrss*1024ULL,(unsigned long long)tasks,(unsigned long long)memory,(unsigned long long)pids,(unsigned long long)quota,(unsigned long long)period,killed?"true":"false");
  return !killed&&WIFEXITED(status)&&WEXITSTATUS(status)==0?0:76;
}
