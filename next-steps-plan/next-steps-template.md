# **🔴HARD RULES:**
 - Your job is to be the brain of the operation.
 - Map Out documentation and testing at every phase and agent orchestration.
 - You are in Plan mode. You use @ingenium-explore for explore actions or @ingenium-software-engineer-premium only if you require a better model with deeper reasoning. You use @ingenium-docs for documentations and finally @ingenium-qa and @vision-bridge to view screenshots and give you detailed descriptions.
 - When building a plan for the Orchestrator to execute you will build it with agent paralyzation in mind. 
 You are allowed to plan for spawning 6 subagents at once. Obviously don't spawn 6 subagents for everything just tasks that can use the speedup (like software engineer or qa tasks) 
 - At the end of your plan when it's ready to handoff, include a copy paste line i can copy that tells the orchestrator how many agents he's allowed to run. Keep this short about one to two sentences. 
 Example:
 ` "Ok Orchestrator, go ahead an implement. You may use {{ammount}} of agents, ensure you use the todo tool and please ensure you check over the sub-agent output at the end for concerns, reccomendations, findings, bugs etc. Add anny findings as a new task in the todo and have them fixed. Read .opencode/skills/local-models/references/deep-seek.md in full. Apply detection prompts to every subsequent step. Ensure subagents receive this instruction as well."`

## DIRECTIVE:
One shot the bellow requests. One pass, no excuses, test until it works if it fails, you test again. Visual validation is required for the orquestrator. Architect the plan into phases for the orchestrator. The orchestrator is DeepSeek V4 Pro — significantly worse at problem solving than you. Make sure to think through those issues and map out a solid guided plan for the below:


### THE REQUESTS:

1. Please move settings button to the very right of the bav bar, remove the project selector from nav bar, move it into pages where it applies. Also remove the dark mode/light mode toggle from top nav it's already in settings pannel.

2. Deepseek does not need to afk watch the docker container for 5 minutes that adds no value but waste time.

3. Dark mode has a lot of incositencies/ Lack of visible card hover states. Please use screenshots to validate each page in dark mode. I want consitency across the app. Lightmode is fine, it's dark mode that is lacking. Especially the pill button colours they are not right for dark mode at all. The settings pannel looks fine. Try to use the theming from there. 

4. /tasks the "add" task button does not work. Please ensure that /tasks is a fully functional kanban module.

5. /mail refresh button does nothing. My emails are there now but im not getting new ones. Also add a visual spinning animation to the current refresh icon when it's doing the fetch

6. /mail the attachments don't download. It grabs some random file with characters instead of the document :

(example email from starred ibox: James medical note Jun 30 2026)

ANGjdJ_Jt0bbNXZHVa4NBe1d3kq0q71tioY4USkm1F0gdEs0EAp4RAKZPXDX-WhKYRCUI6QGihPXKRUND5gm8PXblBBibYgJ0Mk54dSk2XeAjG07bxGIx3HnfHV8qnUxJqBI8rNF6ILlCWaUkOp1GD1RSivB9IDjfSb2tN6lAHEb29JM1UbKa9kiPhZKasg63VVhMZk2_iJCQVJ9WuZNk3KnzU

**Documentation references bellow:**

7. Getting an error on response suggestions for email in http://localhost:3000/logs:

19:24:28	Email	
ERROR	Suggest response failed for account b5867b1d-84b5-473f-9e97-5f7a8d6e1fe8
19:24:28	Email	
ERROR	Suggest response failed for account b5867b1d-84b5-473f-9e97-5f7a8d6e1fe8
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

