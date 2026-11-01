# Candidate Linux retirement basis — qualification pending

Root observed the local Docker server as29.6.2, commit3d80467, API1.55,
containerd2.2.6, runc1.3.6 commit491b69ba, on
6.6.87.2-microsoft-standard-WSL2. This is version evidence, not a passed runtime
retirement test. Kubernetes must qualify its own actual platform.

The matching WSL kernel disables further PID allocation during namespace-init
exit, signals remaining namespace tasks and waits for them. Its final loop keeps
the namespace reaper alive until the other tasks are gone. This supports an
inference about **reaping the actual private PID namespace's init**, provided
that namespace ownership is independently established. It does not establish
that an arbitrary process exit empties a resource scope.
[Matching WSL kernel source](https://raw.githubusercontent.com/microsoft/WSL2-Linux-Kernel/linux-msft-wsl-6.6.87.2/kernel/pid_namespace.c).

The installed Moby revision handles the original container-init exit event and
performs cleanup before marking the container stopped. Some cleanup failures
are logged without preventing that state change. A stopped/Pid0 inspection is
therefore insufficient on its own.
[Moby exit handling](https://raw.githubusercontent.com/moby/moby/3d80467/daemon/monitor.go).

Docker's default wait condition also accepts the initial created state. The
retained wait must refer to a genuinely started original incarnation; an initial
zero status cannot stand in for that exit.
[Moby wait implementation](https://raw.githubusercontent.com/moby/moby/3d80467/daemon/container/state.go).

The matching runc source distinguishes private PID namespaces from shared ones
when cleaning remaining processes. The proposed rule must refuse host/container
PID sharing and unproven namespace configuration.
[runc cleanup](https://raw.githubusercontent.com/opencontainers/runc/491b69ba/libcontainer/state_linux.go).

Before Root enables a physical-retirement constructor, actual evidence must bind
the original immutable create spec, same daemon/container/birth/start, private
namespace and restricted configuration, restart disabled, genuine start and wait,
complete original attach EOF/decoder and error-free final inspection. Required
controls include descendants, fast exit, initial-created wait, incomplete EOF,
shared namespace refusal, restart/incarnation drift and cleanup failures. Keep
the real owner and uncertainty on any failed check.

The manager proposal currently emits signed stopped-observation data. It does
not issue SQL131 scope retirement. Root's authenticated verifier, actual platform
qualification and same-Core transition remain required. A future namespace-based
proof must describe its inference accurately; it must not be reported as a direct
cgroup-empty measurement.
