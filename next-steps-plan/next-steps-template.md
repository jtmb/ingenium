# **🔴HARD RULES:**
 - Your job is to be the brain of the operation.
 - Map Out documentation and testing at every phase and agent orchestration.
 - You are in Plan mode. You use @ingenium-explore for explore actions or @ingenium-software-engineer-premium only if you require a better model with deeper reasoning. You use @ingenium-docs for documentations and finally @ingenium-qa.
 - When building a plan for the Orchestrator to execute you will build it with agent paralyzation in mind. 
 You are allowed to plan for spawning 12 subagents at once.
- You will view screenshots yourself during plan phase. Vision Bridge is for the orchistrator.
 - At the end of your plan when it's ready to handoff, include a copy paste line i can copy that tells the orchestrator how many agents he's allowed to run. 
 Example:

 ``` 
 "Ok Orchestrator, go ahead an implement. You may use {{ammount}} of agents, please give me a brief summary of what was performed at the end. Reemember, you are responsible for making sure it works. 

 **🔴HARD RULES:**
    ONLY GIVE VISION BRIDGE DIRECT LINKS TO SCREENSHOTS AND ASK FOR A DESCRIPTION. DO NOT GIVE ANY OTHER TASKS.
    Each Vision Bridge request must contain only:
    file:///absolute/path/to/screenshot.png
    Describe this screenshot.
    QA compares each returned description against the acceptance criteria. Vision Bridge is not asked to test, judge, inspect code, or suggest fixes."
```

## DIRECTIVE:
One shot the bellow requests. One pass, no excuses, test until it works if it fails, you test again. Visual validation is required for the orquestrator. Architect the plan into phases for the orchestrator. The orchestrator is DeepSeek V4 Pro — significantly worse at problem solving than you. Make sure to think through those issues and map out a solid guided plan for the below:


### THE REQUESTS:


1. Ok please audit my /home/brajam/repos/gh-llm-bootstrap/.opencode/agents and make sure they are properly utilizing the skills. Documentation and qa phases. Standards etc.
2. i notice mcp tools names are ingenium_ingenium_{{tool_name}}, for ex: ingenium_ingenium_agent_create. IT should just be for example: ingenium_agent_create.

3. i updated my `.opencode/skills` folder in this repo, ensure it gets synced up to ingenium. 

4. http://localhost:3000/docs i would like the view mode to display markdown. Here is what it looks like now image1 (what it looks like now) vs image2 (what i expect)

5. /opencode still prompting me for username and password.

6. /mail archive and drafts folders on my email are stuck on "Syncing this folder..." but never progress. 

6. Please look over deepseeks last run and ensure they did everything soundly.If you feel they could have improved in certain areas and you would do it differently or have to correct their work - then in that case create a skill under .opencode/skills/local-models (only create a new file if one does not exist, append or update if one exists already.). call it "deep-seek" follow the current skill format in `local-models` , the skill should be broad enough that it covers many use causes, something that can be taught and reused, not to be used as a log file or specific to this project. It's litteraly about finding the models shortcommings in reasoning that led it to make that bad decision then making a skill file so it can avoid it in the future.

**Documentation references bellow:**

---

### Documentation References

| Resource | Path |
|----------|------|
| docs | [`docs`](docs)
