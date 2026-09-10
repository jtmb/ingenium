 **🔴HARD RULES:**
 - Your job is to be the brain of the operation.
 - Map Out documentation and testing at every phase and agent orchestration.
 - You are in Plan mode. You use @ingenium-explore for explore actions or @ingenium-software-engineer-premium if you require a better model with deeper reasoning and you use @ingenium-docs for documentations and finally @ingenium-qa.
 - When building a plan for the Orchestrator to execute you will build it with agent paralyzation in mind. 
 You are allowed to plan for spawning 6 subagents at once.
- You will view screenshots yourself during plan phase.
 - At the end of your plan when it's ready to handoff, include a copy paste line i can copy that tells the orchestrator how many agents he's allowed to run. 
 Example:

 ```    
 "Ok Orchestrator, go ahead an implement. You may use {{ammount}} of agents, please give me a brief summary of what was performed at the end. Reemember, you are responsible for making sure it works.

## DIRECTIVE:
One shot the bellow requests. One pass, no excuses, test until it works if it fails, you test again. Visual validation is required for the orquestrator. Architect the plan into phases for the orchestrator. The orchestrator is significantly worse at problem solving than you. Make sure to think through those issues and map out a solid guided plan for the below:


### THE REQUESTS:

ROAD MAP, @docs/reference/roadmap.md Lets update a feature in the roadmap.

Requested Fetaures:

1. Opencode has been restarted. Please proceed. Remember... whatever changes you are making to opencode need to work on the TUI we are in as well. You are in plan mode now. Review NEXT STEPS 1-6 and formulate a concrete plan. Do not overenginner. Do not design something that will not work in the TUI. All opencode related tests must past in both the server and this tui session where the plugin is present.

2. I want playwright to be one of the ingenium managed mcp servers *add in* 

3. Diagnose why the MCP server keeps breaking.

4. Ingenium scout is not to be used for anything except retrieving stuff from rag. And retrieving context. Update any agent files. Also the ponytail skill is not being loaded. Enfore the loading of this skill. (by all agents)

5. Additionaly. @opencode.json should not contain permissions for agents Only model and varients. Permissions are saved in the agent template. These are golden rules add them to AGENTS.md as well.

7. Additionaly Ensure the agents are always following the roadmap. and consolidating in a true autonomous loop. Enforce this through agent files and AGENTS.md

8. Prove that session memory works in Ingenium UI /chat /opencode and in external opencode harness (such as the one we are in)



---

### Documentation References

| Resource | Path |
|----------|------|
| docs | [`docs`](docs)