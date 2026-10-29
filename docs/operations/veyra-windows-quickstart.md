# Windows MVP quickstart

This is the Phase 1 portable candidate, separate from the published coding preview and its existing profile. Review [current evidence and limitations](veyra-mvp.md) before using it as an accepted release.

## Open the desktop

Keep the complete qualified package together: Veyra.exe, veyra-service.exe, runtime/root helpers, pinned opencode.exe, brain/plugin directories, licenses and notices. Start Veyra.exe from that package. Qualification on the development machine uses the existing operator launcher and isolated profile; do not start another copy under the user's ordinary AppData profile or relocate an active package.

In Shared workspace, enter the service origin and choose Open shared workspace. HTTPS is required except explicit localhost/loopback HTTP through the established authenticated forward. The chosen origin opens in a separate WebView with no native IPC. Close that service window before selecting another origin. Existing development sign-in is reused from the authorized private .env; credentials do not belong in the package or source.

## Native and WSL work

Choose Native / WSL projects, select or add the project, and confirm the visible execution environment and primary root. Windows native paths and WSL Linux paths remain distinct. A WSL project records the installed distribution and selected Linux user; its shell must actually exist in that environment. Roots containing spaces passed the controlled qualification.

Open Terminal only after selecting the project. Select the shell for the next terminal, start it and verify its actual environment/path. Resize and reconnect are supported while the same service instance lives. Closing an owned terminal was verified; a service restart does not preserve its processes. Queued terminal input/original request details remain in app memory and are lost when the app closes.

The current companion's project/task integration is partial. An unavailable task catalog is not an empty catalog. Native local-agent execution remains a separate gate. The Windows engine panel preserves the existing engine and settings; it is not part of Linux. Do not load a model to qualify packaging or terminals.

## External brain

The package's OpenCode-with-brain.cmd/ps1 launcher validates the exact pinned dependency and consumer bytes before launching OpenCode 2.0.11. It adds the consumer to existing configuration without importing the dependency's global model/credential settings. An explicit WSL invocation is:

```powershell
.\OpenCode-with-brain.ps1 --wsl Ubuntu your-linux-user /absolute/path/to/opencode '/absolute/project path'
```

Use the actual distribution, user, executable and project path; there is no environment fallback. Read [brain verification](veyra-brain.md) for discovery, safe exact-body loading and rollback. Discovery does not grant external account access or prove every capability.

## Recovery and known limits

Closing the main window hides it to the tray; single-instance relaunch returned to the original GUI without replacing the service. Whole-service Exit remains unqualified: the preserved engine owner refuses the observed shutdown with unknown state. Do not force-stop or weaken its guard to report success. Native configuration-unavailable, first-run/recovery visuals, full tray/exit, fresh replacement-image WebView, cross-origin identity-provider sign-in and 100–200 percent scaling remain open.

Use the existing isolated runtime/profile and prior verified package/configuration for operator recovery. Preserve models, credentials, source, unique failure evidence and all user profiles. Installer/signing qualification is separate.
