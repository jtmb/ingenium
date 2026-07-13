# **🔴HARD RULES:**
 - Your job is to be the brain of the operation.
 - Map Out documentation and testing at every phase and agent orchestration.
 - You are in Plan mode. You use @ingenium-explore for explore actions or @ingenium-software-engineer-premium only if you require a better model with deeper reasoning. You use @ingenium-docs for documentations and finally @ingenium-qa and @vision-bridge to view screenshots and give you detailed descriptions.
 - When building a plan for the Orchestrator to execute you will build it with agent paralyzation in mind. 
 You are allowed to plan for spawning 6 subagents at once. Obviously don't spawn 6 subagents for everything just tasks that can use the speedup (like software engineer or qa tasks) 
 - At the end of your plan when it's ready to handoff, include a copy paste line i can copy that tells the orchestrator how many agents he's allowed to run. Keep this short about one sentence. 
 Example:
 ` "Ok Orchestrator, go ahead an implement. You may use {{ammount}} of agents, ensure you use the todo tool. "`

## DIRECTIVE:
One shot the bellow requests. One pass, no excuses, test until it works if it fails, you test again. Visual validation is required for the orquestrator. Architect the plan into phases for the orchestrator. The orchestrator is DeepSeek V4 Pro — significantly worse at problem solving than you. Make sure to think through those issues and map out a solid guided plan for the below:


### THE REQUESTS:

1. Please look over deepseeks last run and ensure they did everything soundly.If you feel they could have improved in certain areas and you would do it differently or have to correct their work - then in that case create a skill under .opencode/skills/local-models. call it "deep-seek" follow the current skill format in `local-models` , the skill should be broad enough that it covers many use causes, something that can be taught and reused, not to be used as a log file or specific to this project. It's litteraly about finding the models shortcommings in reasoning that led it to make that bad decision then making a skill file so it can avoid it in the future.

2. If you find any major fucks up and issues during step `1.` above, you will include it in the current plan to be fixed in the next run. (after updating the skill.)    

3. `gh-llm-bootstrap` is not the public project. The public project is the containers opencode default global config location  `~/.config/opencode/opencode.json`. The containers file space is to be refered to as the "server" since it may be deployed remotely. And our opencode session `gh-llm-bootstrap` is considered external (not public) hence why it connects with the plugin. Please audit current system with this in mind. 

Additional information: The opencode webui in the server (container) uses the global config. So does email etc. If the opencode webui creates a new project or opens an existing project, that is tracked via the plugins (as if it were external). Does that make sense do you have any questions?


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

---
