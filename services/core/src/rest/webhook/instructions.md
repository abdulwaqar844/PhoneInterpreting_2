### ASST Lariana — Simplified Emergency Call Flow

```text
┌──────────────────────────┐
│      Incoming Call       │
│      ASST Lariana        │
└────────────┬─────────────┘
             ↓
┌──────────────────────────┐
│ Log Call Received Time   │
└────────────┬─────────────┘
             ↓
┌──────────────────────────┐
│ Voice Prompt             │
│ "Please say the language │
│  you require."           │
└────────────┬─────────────┘
             ↓
       ┌─────────────┐
       │ Language    │
       │ Recognised? │
       └──────┬──────┘
          YES │   │ NO / No Response
              │   └──────────────────────┐
              ↓                          ↓
┌──────────────────────────┐   ┌──────────────────────┐
│ Log Language + Time      │   │ Connect to Human     │
│                          │   │ Operator Immediately │
└────────────┬─────────────┘   └──────────┬───────────┘
             │                            ↓
             │                  ┌──────────────────────┐
             │                  │ Operator Selects    │
             │                  │ Required Language   │
             │                  └──────────┬───────────┘
             │                             │
             └──────────────┬──────────────┘
                            ↓
                 ┌──────────────────────┐
                 │ Find Available       │
                 │ Interpreter          │
                 └──────────┬───────────┘
                            ↓
                 ┌──────────────────────┐
                 │ Send Call Request    │
                 │ to Interpreter       │
                 └──────────┬───────────┘
                            ↓
                      ┌───────────┐
                      │ Accepted? │
                      └─────┬─────┘
                       YES  │ │ NO / Timeout
                            │ └───────────────┐
                            ↓                 ↓
                ┌───────────────────┐   ┌─────────────────┐
                │ Connect Caller +  │   │ Try Next        │
                │ Interpreter       │   │ Interpreter     │
                └─────────┬─────────┘   └────────┬────────┘
                          │                      │
                          │              None Available
                          │                      ↓
                          │             ┌─────────────────┐
                          │             │ Human Operator  │
                          │             │ Manual Routing  │
                          │             └────────┬────────┘
                          │                      │
                          └──────────┬───────────┘
                                     ↓
                           ┌───────────────────┐
                           │ Log Connection    │
                           │ Time & Result     │
                           └───────────────────┘
```

### Development changes

| Priority | Change                    | What needs to be done                                                                                                    |
| -------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **P0**   | Spoken language selection | Replace complex IVR with one prompt: **“Please say the language you require.”**                                          |
| **P0**   | Speech recognition        | Recognise supported language names such as `ARABO`, `FRANCESE`, `UCRAINO`, etc., including reasonable spoken variants.   |
| **P0**   | Recognition fallback      | If speech isn't recognised or there is no response, **immediately route to an operator**. Don't create another IVR loop. |
| **P0**   | Operator fallback         | Provide operator routing for recognition failure, system errors, interpreter failure, or no interpreter availability.    |
| **P0**   | 24/7 fallback             | Maintain **Platform → Operator → Manual interpreter routing** as the fallback chain.                                     |
| **P0**   | Connection-time logging   | Record call received, language identified, operator connected, interpreter requested, accepted and connected timestamps. |
| **P1**   | Emergency flag            | Automatically identify ASST Lariana/ED requests as **Emergency / Urgent Healthcare**.                                    |
| **P1**   | Live interpreter status   | Don't rely only on configured/static working hours; determine whether the interpreter can actually receive the request.  |
| **P1**   | Accept/decline            | Interpreter gets a request and can accept/decline it.                                                                    |
| **P1**   | Request timeout           | If the interpreter doesn't respond within the configured short timeout, consider that attempt unsuccessful.              |
| **P1**   | Automatic rerouting       | Automatically try the **next eligible interpreter** after decline/no-answer/timeout.                                     |
| **P1**   | Final operator escalation | If no interpreter can be connected, immediately transfer control to the human operator.                                  |

The resulting production logic should essentially be:

```text
Incoming Call
     ↓
"Say your language"
     ↓
Language identified?
   ↙       ↘
 YES       NO
  ↓         ↓
Interpreter   Operator
Routing       ↓
  ↓        Select Language
  └─────┬─────┘
        ↓
Available Interpreter
        ↓
Accept?
 ↙             ↘
YES          NO/TIMEOUT
 ↓               ↓
CONNECT       NEXT INTERPRETER
                  ↓
              None available?
                  ↓
               OPERATOR
```

The most important architectural rule is that **failure should always move the caller closer to a human, never deeper into automation**. For an Emergency Department caller, there should be no repeated menus, repeated language questions, or long retry sequences.
