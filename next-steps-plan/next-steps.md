
### DOCUMENTATION REFERENCES:

MCP Tools : `docs/HOW-TO/mcp-tools.md`
ARCHITECTURE: `docs/ARCHITECTURE.md`
Synthesis: `docs/HOW-TO/synthesis.md`
Personality: `docs/HOW-TO/personality.md`
Conventions: `docs/CONVENTIONS.md`
README: `README.md`
EMAIL: `docs/HOW-TO/email.md`
SELF LEARNING PIPELINE: `docs/self-learning-pipeline.md`
---

## Bugs:

### /projects

1. No Search bar on archived tab

### /Skills

1. Skills made by the Synthysis sytem are showing up as:
 llm-synthesized-name-goes-here, for example : 
`llm-synthesized-global-config-management`. 

    Skills should not follow this system for nameing conventions they should just be name-goes-here, for example: `global-config-management`

2. Created Skills should have dates when they are created, both in the document and in the UI.

3. The editor/viewer for markdown is small and cropped see screenshot: `next-steps-plan/screenshots/Screenshot 2026-07-11 113842.png` it should use a standard window size for the full screen overlay for the editor/viewer.

4. metadata.json on the skills that have been synthysized don't contain relevant tags. They need tags. metadata.json is a way for the models to quickly pickup what skills are listed under `references/` for each skill. (SKILL.md acts as a pointer to said skills and metadata.json acts as a quick index for the models to know what that skill contains)

5. Please see screenshot. `next-steps-plan/screenshots/Screenshot 2026-07-11 114730.png` as you can see the contents of the code blocks are not visible due to grey on grey text. This needs to be fixed in the editor/viewer.

6. There are a lot of Skills. As part of the synthesis process, the LLM should analyze the current skills in `/skills` on the server side and see if it can fit the current skill into any other existing skill using the criteria and format from `step 4.` 

    Currently there are 45 skills i would like the LLM synthesis to try to maintain 20 skills per project, new addictions should be tried to fit in the users current skills. Using the format in `step 4.` we should be able to aquire a cleaner and more manageble project structure.

### /logs

1. I am seing :

    ```
    11:36:31	Skills	
    WARN	Skill file not found on disk
    11:36:31	Skills	
    WARN	Skill file not found on disk
    11:36:31	Skills	
    WARN	Skill file not found on disk
    11:36:31	Skills	
    WARN	Skill file not found on disk
    11:41:38	Skills	
    WARN	Skill file not found on disk
    11:41:38	Skills	
    WARN	Skill file not found on disk
    11:41:38	Skills	
    WARN	Skill file not found on disk
    ``` 
    What does this mean? My skills from my external project (current), or is it the skills for the global project that lives on the server aka, docker container?


### /mail

1. clicking "add Account" brings up the "Add Email Account" Screen. It presents 3 buttons:
    - Gmail
    - Outlook
    - Custom


    an error occurs when clicking any of the buttons instead of going to the expected setup screen:

    *ERROR:* `{"error":{"code":"OAUTH_ERROR","message":"require is not defined"}}`


2. The Purpose of mail is supposed to be a place wher eyou connect your email client via oath. IT has mcp tools that allow the model to interact with the email client so it can do things like clean up emails, draft responses to emails based on how you respond to your emails etc. Full email management over mcp. Im not sure how much of it is working, you will need to ivestiate. The mcp tools seem to have been added. Please Ensure all the above features are functioning and email client is built and working.
    

### /mcp-servers

1. The Tools tab do not intially load the tool count when loading in the /mcp-servers page. The tool count indicator on the tab stays at 0 until you click on the tab, and then it resets back to 0 again after refreshing the page cycle repoeats etc.
2. Please confirm that turning tools on and off in in the tools tab actually dissables those tools for the agents.

### /observations

1. `Total` and `Pending` count are both showing `0` yet there observations present. See screenshot: `next-steps-plan/screenshots/observations.png`

### /personality
1. /personality is completely blank. No content. I don;t think the pipeline is working. Please investigate. See screenshot: `next-steps-plan/screenshots/personality.png` 


## opencode CLIENT BUGS

1. When i open my opecode client i get an plugin error: Failed to install plugin packages/ingenium-extension/observer.ts@: Could not read package.json: Error: ENOTDIR: not a directory, open '/home/brajam/repos/gh-llm-bootstrap/packages/ingenium-extension/observer.ts/package.json'

    is the above still used? if so could this be why the synthysis pipeline is not firing?

## Features:

### /tasks

1. Right now /tasks is a very simple task manager that kind of replicates the look of a kanban board. See screenshot: `next-steps-plan/screenshots/Screenshot 2026-07-11 121053.png` Agents have full control of this task board with mcp tools. **(!as is the pattern with almost everything in Ingenium!)**

    I would like a full kanban board. with these features:

    - Multiple Board Views: Toggle between List/Backlog (spreadsheet-style prioritization), Board (Kanban columns), and Timeline/Roadmap (Gantt-style date visualization) without losing context.

    - Horizontal Swimlanes: Group rows by Assignee, Epic, or Priority to visually split the board, allowing you to see bottlenecks per team member or major feature.

    - Column Constraints: Enforce Work-In-Progress (WIP) Limits per column (e.g., "In Progress: Max 5"), with visual warnings (turning red/counting down) when limits are breached.

    - Compact vs. Rich Card Density: A UI toggle allowing users to switch between dense lists (text only) and rich cards (showing avatars, badges, and due dates) to save screen real estate.

    - Hierarchical Issue Types: Native support for Epics (parent) > Stories/Tasks (children) > Sub-tasks (checklist items with their own statuses). The board must visually link sub-tasks to their parent.

    - Advanced Custom Fields: Support for over 15 field types out-of-the-box: Text, Paragraph, Number, Date, DateTime, Single/Multi-Select, User Picker, Group Picker, Checkboxes, Radio, URL, and Scripted/Calculated Fields (e.g., Due Date = Start Date + 5 days).

    - Rich Text Descriptions: A WYSIWYG editor that supports @mentions, inline images, code blocks (with syntax highlighting), and nested checklists inside the description.

    - Time Tracking: Native input for Original Estimate, Time Spent, and Remaining Estimate, with a visual "time remaining" pie/badge on the front of the card.

    - Project Full-Text Search: A spotlight-style search bar (Ctrl+K) that searches card titles, descriptions, comments, and custom field values, with syntax highlighting for the matched terms.

    - Bulk Edit Mode: A checkbox mode on the board that allows users to select 10 cards, drag them all to a new column simultaneously, or mass-edit a custom field.

    - Threaded Comments: A comment section that supports inline replies, edit history, and reactions (👍/👀).

    - Activity Stream: A reverse-chronological timeline inside the sidebar showing every change (status change, field edit, attachment upload, comment) with the user's avatar and a timestamp.

    - Linked Dependencies: A visual "Blocked By / Blocks" relationship map inside the card, showing which other cards are holding this one back, with click-through navigation.

    - In-App Toast Notifications: A bell icon that visually notifies users when they are @mentioned, assigned to a card, or when a card they are watching changes status.

    - @Mention Autocomplete: Typing @ must bring up a agent picker with profile pictures and role labels. Allow scheduling agents to do certain tasks. /jobs will handle running the agents. Essentially i want to be able to put tasks on the kanban board and have agents pick them up and complete them. (all configurable ofc)


### ADD NEW PAGE: /jobs

1. (back-end): Jobs will be jenkins like job scheduler/runner, for agents. It will run on top of opencode already on the server, jobs are scheduled with opencode cli.
2. (front-end): jenkins like job scheduler/runner but using our ui and design principles observed in the screenshots and also refer to `docs/CONVENTIONS.md:15`	for styling mandate — colour palette, typography, layout, card rules. 
3. All mcp tools available for use. Agents can be configured as jobs that run on cron or based on triggered event. 
4. Please include a log output screen of the job like jenkins does. We need to see what the agents are doing during the jobs.

