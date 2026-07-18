 **🔴HARD RULES:**
 - Your job is to be the brain of the operation.
 - Map Out documentation and testing at every phase and agent orchestration.
 - You are in Plan mode. You use @ingenium-explore for explore actions or @ingenium-software-engineer-premium if you require a better model with deeper reasoning and. You use @ingenium-docs for documentations and finally @ingenium-qa.
 - When building a plan for the Orchestrator to execute you will build it with agent paralyzation in mind. 
 You are allowed to plan for spawning 12 subagents at once.
- You will view screenshots yourself during plan phase. Vision Bridge is for non vision models.
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

SETTINGS:
1. when adding a provider the provider ID field only allows you to type one character beffore it deselects the text input box and forces you to type the next letter...one at a time. 
2. Providers shoudl be allowed multiple roles. (but not primary and backup at the same time)
3. When i try to save using my lmstudio base url http://192.168.0.13:1234/v1 i get: "providers[0].baseURL: endpoint points to an internal/private network address"
4. If you are filling out the providers tab (adding a provider) and you exit to another settings tab and then return to the providers tab all your progress is gone.
5. Please see picture: Even without an api key available opencode provides free models: Please can we have this automatically set in providers and in the Chat window for use.

/SECRETS:
1. It says to Unseal Vault, where is the Key? What is the Process on init? It should not be obscured from the user in the UI. The vault Passprase should be setup in the UI if one has not been set already.

/CHAT
1. If no providers are configured the dropdowns should be muted and in a dissabled state until providers are available.

---

### Documentation References

| Resource | Path |
|----------|------|
| docs | [`docs`](docs)


7. Please look over deepseeks last run and ensure they did everything soundly.If you feel they could have improved in certain areas and you would do it differently or have to correct their work - then in that case create a skill under .opencode/skills/local-models (only create a new file if one does not exist, append or update if one exists already.). call it "deep-seek" follow the current skill format in `local-models` , the skill should be broad enough that it covers many use causes, something that can be taught and reused, not to be used as a log file or specific to this project. It's litteraly about finding the models shortcommings in reasoning that led it to make that bad decision then making a skill file so it can avoid it in the future.



<!-- 
1. /settings > pipeline. Should be emptied. Contents should be moved to "Providers" (inside the config tab). Make it share the providers config that opencode uses. So when i set my Providers in opencode it's already set in ingenium provider settings and vice versa.

2. /backups new backup endpoint. Full mcp support. This new page will allows us to export a zip file with our :

 - Ingenium DB export
 - Opencode DB Export

 It should have the ability to import/export backups from this one zip file and restore either one or both services. It should also have automatic revisioned backups every hours, days (configurable via settings).

 3. http://localhost:3000/docs already acts like a RAG. I would like to enhance it with full RAG capabilities so we can get rid of thread. Thead is another application i made that stores conversation context in a rag, you can bulk upload documentation for you agents to search from offline etc. please see: /home/brajam/repos/thread

    Then present me a solid plan. If you think it could be done better or improved or done differently feel free to ask questions using the question tool.

5. /secrets I want a Hashicorp Vault like secrets manager that i can use in the UI to make secrets that my agents can call and use. All through MCP. On the UI side, it should act as a password manager i can use to retrieve my passwords (like vault warden) -->