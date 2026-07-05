\# SCB Core is Frozen



\## Mission



This is a maintenance task, NOT an architecture task.



Assume SCB 3.7 is frozen.



Do not redesign the system.



Fix only the reported issue using the smallest possible localized change.



\---



\## Core Rules



The following architecture is FROZEN and MUST NOT be changed unless explicitly requested.



\### Do NOT modify



\- Session lifecycle architecture

\- Settlement architecture

\- Destroy Pipeline

\- Reconciliation architecture

\- SCB state machines

\- RPC transaction boundary

\- Database schema

\- Public API contracts

\- SettlementResult shape

\- Module boundaries

\- Folder structure

\- Naming conventions

\- Existing business rules



\---



\## Allowed changes



You MAY:



\- Fix bugs

\- Add small isolated features

\- Improve UI

\- Improve UX

\- Improve validation

\- Improve error handling

\- Add logs

\- Add tests

\- Refactor only inside the affected module when necessary



\---



\## Forbidden



Do NOT:



\- Refactor unrelated files

\- Move responsibilities between modules

\- Introduce new architecture

\- Rewrite working code

\- Rename exported APIs

\- Change transaction flow

\- Change state-machine behavior

\- Replace existing implementations because you "prefer" another design



\---



\## Scope



Touch only files directly related to the reported issue.



If another issue is discovered:



DO NOT FIX IT.



Mention it under:



"Out of scope findings"



and continue only with the requested task.



\---



\## Before editing



State:



1\. Root cause

2\. Files to modify

3\. Why those files only



If additional files become necessary, explain why before editing them.



\---



\## After completion



Provide:



\- Files changed

\- Exact behavioral change

\- Confirmation that SCB Core remains unchanged

\- Tests executed

\- Any out-of-scope findings



\---



\## Golden Rule



SCB Core is frozen.



Every change must preserve the existing architecture.



Default action:



Fix, don't redesign.



If the requested fix would require architecture changes, STOP and explain why instead of implementing them.





