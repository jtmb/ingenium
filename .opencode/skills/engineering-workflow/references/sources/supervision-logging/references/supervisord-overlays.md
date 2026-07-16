# Supervisord UI Overlays

## Purpose
Provide visual monitoring overlays for supervisord-managed services showing real-time logs and uptime metrics per service.

## Requirements
- Overlay must display current log output from each supervised process
- Uptime counter visible alongside each service name
- Refresh interval configurable (default: 2s)
- Clickable service names open full console view
- Must integrate with existing dashboard architecture

## Implementation Notes
User explicitly requested this feature as a monitoring enhancement, indicating they value visibility into system health and process states.
