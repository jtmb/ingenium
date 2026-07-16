# **🔴HARD RULES:**
 - Your job is to be the brain of the operation.
 - Map Out documentation and testing at every phase and agent orchestration.
 - You are in Plan mode. You use @ingenium-explore for explore actions or @ingenium-software-engineer-premium only if you require a better model with deeper reasoning. You use @ingenium-docs for documentations and finally @ingenium-qa.
 - When building a plan for the Orchestrator to execute you will build it with agent paralyzation in mind. 
 You are allowed to plan for spawning 12 subagents at once. Obviously don't spawn 12 subagents for everything just tasks that can use the speedup (like software engineer or qa tasks) 
 - At the end of your plan when it's ready to handoff, include a copy paste line i can copy that tells the orchestrator how many agents he's allowed to run. Keep this short about one to two sentences. 
 Example:
 ` "Ok Orchestrator, go ahead an implement. You may use {{ammount}} of agents, please give me a brief summary of what was performed at the end. Reemember, you are responsible for making sure it works. So verify yourself at the end that everything works, it's your ass on the line."`

## DIRECTIVE:
One shot the bellow requests. One pass, no excuses, test until it works if it fails, you test again. Visual validation is required for the orquestrator. Architect the plan into phases for the orchestrator. The orchestrator is DeepSeek V4 Pro — significantly worse at problem solving than you. Make sure to think through those issues and map out a solid guided plan for the below:


### THE REQUESTS:



1. (BIG FIX FEATURE) Every endpoint is supposed to have mcp tools and these tools should be turned on and off in /mcp-servers tools tab:
```
Projects
Skills
Tasks
Jobs
Plugins
Mail
Agents
MCP
Config
Observations
Personality
Pipeline
Logs
Status
```
Some already have tools.

2. /opencode in te opecode terminal i see that the user opencode runs under does not have the ability to install packages or sudo. This is necessecery for agentic building and workflows.  

```
appuser@0630c4b3facd:/workspace$ ls
hello.html
appuser@0630c4b3facd:/workspace$ apt update
Reading package lists... Done
E: List directory /var/lib/apt/lists/partial is missing. - Acquire (13: Permission denied)
appuser@0630c4b3facd:/workspace$ sudo apt update
bash: sudo: command not found
appuser@0630c4b3facd:/workspace$
```

3. Here is a sidequest for you.Ingenium extension is not syncing the new skills in /skills to my skills in /home/brajam/repos/gh-llm-bootstrap/.opencode/skills (this project) are not automatically syncing new skills. The extension (one of the plugins) is supposed to sync agents, skills, opencode.json, plugins (i think plugins as well please check current sync configuration).

4. Please see this image of my current /opencode screen `/home/brajam/repos/gh-llm-bootstrap/opencode.png`. I want some kind of beatutiful reactive overlay side button that i can click to quickly change between opencode CLI and opencode web. Im thinking somekind of tab button that sits at the right edge of the screen that is mostly translucent until you hover it but it's still apparent it's there when not hovered. Please ensure opencode cli loads properly through the iframe, there is a known issue that causes visual distortion when going through iframes, there is a workaround.

5. /mail smart replies collapse state keeps resetting on it's own while im still on the page

6. When resizing the left emails pannel the part of the container that contains the times the emails came in seem to clip when dragging the resize slider. Also the resize slider resets position everytime you click to slide it. (only on the left side, the right side reply slider works fine)

7. (BIG FEATURE) http://localhost:3000/ the current "dashboard" serves no purpose it's just buttons of things that are already on the nav bar. Think to yourself, if you were using this all in one workspace app with self learning ai, email, code, kanban etc. What would you have on that home page?

8. Please look over deepseeks last run and ensure they did everything soundly.If you feel they could have improved in certain areas and you would do it differently or have to correct their work - then in that case create a skill under .opencode/skills/local-models (only create a new file if one does not exist, append or update if one exists already.). call it "deep-seek" follow the current skill format in `local-models` , the skill should be broad enough that it covers many use causes, something that can be taught and reused, not to be used as a log file or specific to this project. It's litteraly about finding the models shortcommings in reasoning that led it to make that bad decision then making a skill file so it can avoid it in the future.

**Documentation references bellow:**
---

### Documentation References

| Resource | Path |
|----------|------|
| MCP Tools | [`docs/HOW-TO/mcp-tools.md`](docs/HOW-TO/mcp-tools.md) |
| Architecture | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Synthesis | [`docs/HOW-TO/synthesis.md`](docs/HOW-TO/synthesis.md) |
| Personality | [`docs/HOW-TO/personality.md`](docs/HOW-TO/personality.md) |
| Conventions | [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) |
| README | [`README.md`](README.md) |
| Email | [`docs/HOW-TO/email.md`](docs/HOW-TO/email.md) |
| Self-Learning Pipeline | [`docs/self-learning-pipeline.md`](docs/self-learning-pipeline.md) |
| Tasks | [`docs/HOW-TO/tasks.md`](docs/HOW-TO/tasks.md)
| HOW-TO | [`docs/HOW-TO`](docs/HOW-TO)
---
<!-- 1. <button class="bg-blue-600 text-white py-2 px-4 rounded text-sm hover:bg-blue-700">Add</button> in /tasks Still does not work. I click the blue "Add" button nothing happens.

2. same with: <button class="bg-blue-600 text-white p-2 rounded text-sm hover:bg-blue-700">Add Server</button> in /mcp-servers the blue "Add Server" button does not work. is taking up the entire screen. It should be a smaller screen overlay. The actuall boxes where you enter information are all centered anyways so the extra space is just dead space. Also the active email account should automatically be selected as the From in the dropdown.

3. in /logs there are still white borders around the "INFO" style pills.

4. /mail Smart reply works! There does seem to be a bug. Every time i open an email it re-generates the smart reply again even if it already generated smart replies for that particullar email already. 

5. /mail once step 4 is fixed, i would like it to be a setting in the settings menu for mail. I would like the user to be able to select if they want smart replies on or off. There should also be a setting for smart replies happening automatically or only when the user presses a button in the smart replies section to generate them. 

6. /mail the compose screen is a full screen overlay with all the content centered in the middle same with /jobs add job screen. Please make the fulll screen overlays one standard size it should not eat the entire screen. The /skills open state overlay size is a good size to use as a example. 

7. /Service Status synthesys engine shows status as "starting" but its not accurate the service is fine, just the actuall card reading it seems to be bugged. When i i open the synthesis-engine card to see its details i see:

```
"Failed to load service details

HTTP 404

synthesis-engine
Process Logs (stderr)
↻ Refresh
BAD_NAME: synthesis-engine"
``` -->

<!-- 1. Please look over deepseeks last run and ensure they did everything soundly.If you feel they could have improved in certain areas and you would do it differently or have to correct their work - then in that case create a skill under .opencode/skills/local-models (only create a new file if one does not exist, append or update if one exists already.). call it "deep-seek" follow the current skill format in `local-models` , the skill should be broad enough that it covers many use causes, something that can be taught and reused, not to be used as a log file or specific to this project. It's litteraly about finding the models shortcommings in reasoning that led it to make that bad decision then making a skill file so it can avoid it in the future.

2. Dark mode flashes on every page load when not in dark mode... this is not accceptable. Its very brief you will not capture it with a screenshot so don't bother. Fix root problem.

3. Observations not being logged not even sure if they are working there has not been a new observation in 30 40 minutes of this run going?. Very unlikely.

4. /mail i clicked starred folder and it started resyncing my entire inbox again. Im tired of going in circles/ All issues persists 

5. Not sure how many times i need to say to do proper testing im not sure how obvious things like tyhis i keep calling out, how they get missed and the tests pass? pretty useless test would you not say? -->

<!-- 2. Email should be a global app not tied to a specific project. Also from what i can tell all issues persist with email from pervious ask. It seems deepseek decided the rule about load times and caching was optional and skipped it.Emails content is not even loading. Im not sure what kind of playwright tests are being done and how this being missed.

3. http://localhost:3000/mcp-servers MCP Servers is empty it should  be part of the things that get synced. Project level mcp configurations are in opencode.json

4. /observations not persisting across rebuilds, it sits empty now and /personality profile take almost a minute to load and then resets again on page reload or renaviagtion and takes another minute to load.

None of this is acceptable. -->



<!-- 1. Please look over deepseeks last run and ensure they did everything soundly.If you feel they could have improved in certain areas and you would do it differently or have to correct their work - then in that case create a skill under .opencode/skills/local-models. call it "deep-seek" follow the current skill format in `local-models` , the skill should be broad enough that it covers many use causes, something that can be taught and reused, not to be used as a log file or specific to this project. It's litteraly about finding the models shortcommings in reasoning that led it to make that bad decision then making a skill file so it can avoid it in the future.

2. If you find any major fucks up and issues during step `1.` above, you will include it in the current plan to be fixed in the next run. (after updating the skill.)    

3. `gh-llm-bootstrap` is not the public project. The public project is the containers opencode default global config location  `~/.config/opencode/opencode.json`. The containers file space is to be refered to as the "server" since it may be deployed remotely. And our opencode session `gh-llm-bootstrap` is considered external (not public) hence why it connects with the plugin. Please audit current system with this in mind. 

4. Projects load, but they take forever to load now for some reason. As do all of their associated ui endpoints.... /plugins /skills. Observation and Peronality are just completely gone as well after reload, so are logs. This is so wrong.

Additional information: The opencode webui in the server (container) uses the global config. So does email etc. If the opencode webui creates a new project or opens an existing project, that is tracked via the plugins (as if it were external). 

## ADDITIONAL BUGS I FOUND LOOKING THROUGH THE UI:

MAIL:
- Initial Cahcing in email still not working. Inbox takes like 30 seconds or more to populate and then every email also takes almost a minute to open. Images are also not loading in said emails.
- Folders were supposed to downloaded during the inital cache but yet when i click on each folder it still takes almost a minute to load each one in.
- No inbox other than the main `INBOX` folder is loading emails.


Does that make sense do you have any questions? -->

<!-- 1. plan to fix deepseeks shit mistakes with mail:

```
Cache working. Switch back to Gmail served emails instantly from prefetch. Commit.
$ cd /home/brajam/repos/gh-llm-bootstrap && git add -A && git commit -m "feat(mail): background prefetch — INBOX loads instantly after first cache

- Prefetch effect runs on account switch after folders load
- Silently fetches INBOX + top 7 folders into cache (no UI change)
- Email fetch checks cache first — serves instantly on revisit
- Verified: switching Demo→Gmail→Demo→Gmail loads INBOX in <2s on revisit"
[the-next-level 71cefa7] feat(mail): background prefetch — INBOX loads instantly after first cache
 2 files changed, 17 insertions(+), 1 deletion(-)
Verified: First Gmail load takes ~10s (API fetch). Switching to demo and back to Gmail serves INBOX instantly from the prefetch cache. The background prefetch silently populates INBOX + 7 other folders on account switch, so subsequent visits are immediate.
```

I want it to prefectch the inbox and save it on disk or db (whatever is best practice) and then there is a period sync for new emails. (that the user can trigger and configure the fetch frequency in settings) 

I want the demo account remove as well. And i want the account selector cleaned up and to be give an aesthetic in the style of the mail app itself.

Every inbox, must have 3 emails visually checked via screenshots. Look through this chat and make a list of every issue i have described regarding email. It must be manually checked with playwrigh actions AND screenshot validation. write a full suit for mail. every interaction. all screenshot validated. It should not take more than 2 seconds to load an inbox after the first cache insert. This should also be tested. Also test for page load irregularities, like when you press a new email. is it shifting the ui around? etc.

2. The learnings and observations and personality system no longer works. I need a full diagnosis as to why.

All logs, observations and personalities have MCP tools you can easily use to check.

i NEED THIS TO WORK. I need you to also evalutate the current self learning pipeline and make a plan to prevent it from breaking again. And how to improve it. Remeber, the plugins have to work in the extension has to work in the background, it cant be relient on the user having custom agents to execute commands. (that;s how it was before anyways.)

3. In the UI http://localhost:3000/plugins /config are both completely empty. I would like you to trouble shoot the project onboarding and figure out why these are not being synced from the project client using the extension. Everything gets synced via the extension for external clients like the one we are on now.

Make a plan for the above. I want this working in one shot. I want full mail coverage testing on MY inbox not the demo inbox. -->

