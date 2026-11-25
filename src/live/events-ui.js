/* live/events-ui.js — `custom` (todo edits) and `extension_ui_request` events,
   plus everything that touches ask bubbles and the "Other" handshake.

   Pure ask logic lives in app/ask-model.js + app/ask-answer.js. The "Other"
   handshake is a private variable of this module: other code (tab switch, tool
   end, abort, get_state, undo, new_session, closing the last tab) can only call
   finalizeAsks() / resetHandshake() / answerAsk(). It is never part of a snapshot.
   Registers window._Live.EventsUi; load after runtime.js and todo-phases.js. */
(function () {
  "use strict";
  window._Live = window._Live || {};

  /**
   * @param {object}   ctx
   * @param {object}   ctx.state
   * @param {object}   ctx.rt
   * @param {Function} ctx.notify
   * @param {Function} ctx.send           send a command to the active omp
   * @param {object}   ctx.todo           TodoPhases instance
   * @param {Map}      ctx.loginInFlight  sessionId → Set of in-flight login tokens
   */
  function create({ state, rt, notify, send, todo, loginInFlight }) {
    // { askId, text }: "Other" free text awaiting its input/editor follow-up.
    let handshake = null;

    // The ask ended (tool end / abort / exit): drop the handshake and settle any
    // bubble still waiting — 18.x never sends `cancel` on a timeout.
    // `aborted`: abort / process exit / tool error — a click still in flight never got a result.
    function finalizeAsks({ aborted = false } = {}) {
      handshake = null;
      const next = window.AskModel.finalize(state.messages, { aborted });
      if (next !== state.messages) state.messages = next;
    }

    // Drop an armed "Other" handshake (tab switch, undo, new select, cancel).
    function resetHandshake() {
      handshake = null;
    }

    function pushAskBubble(bubble) {
      // select/input may arrive before tool_execution_start; the card hoists past orphans then.
      bubble.orphan = !window.AskModel.hasRunningAskCard(state.messages);
      state.messages = window.AskModel.addBubble(state.messages, bubble).messages;
      notify();
    }

    /**
     * Respond to a pending ask bubble (select / input / editor request).
     * The logic lives in app/ask-answer.js: it decides which frames to send
     * (e.g. the two-step "Other" handshake) and how the bubble changes.
     * @param {string} id  The extension_ui_request id the bubble currently answers.
     * @param {string|object} payload  `{ value }` | `{ custom }` | `{ clearOther: true }`
     *   | `{ text }` | `{ cancelled: true }`. A bare string is treated as `{ value }`.
     */
    function answerAsk(id, payload) {
      const p = typeof payload === "string" ? { value: payload } : payload;
      const plan = window.AskAnswer.planAnswer(window.AskModel.findOpen(state.messages, id), p);
      if (!plan) return;
      state.messages = window.AskModel.patchOpen(state.messages, id, plan.patch);
      // Armed before the frame goes out so the follow-up request can never beat it.
      if (plan.handshake) handshake = plan.handshake;
      notify();
      for (const frame of plan.frames) send({ type: "extension_ui_response", id, ...frame });
    }

    function onCustom(ev) {
      if (ev.customType === "user_todo_edit" || ev.customType === "todo_edit" || ev.customType === "todo" || ev.customType === "todo_write") {
        const raw = ev.data?.phases ?? ev.data?.todos ?? ev.data;
        if (todo.apply(raw, { fallback: raw?.phases ?? raw ?? [] })) notify();
      }
    }

    function onExtensionUiRequest(ev) {
      // URL to open in the system browser (e.g. OAuth auth page).
      if (ev.method === "open_url") {
        // In Tauri, window.open() creates a webview rather than opening the system
        // browser. Use the open_url_external Rust command (open crate → ShellExecute
        // on Windows) so OAuth URLs open in the user's actual browser.
        if (window.__TAURI__) {
          window.__TAURI__.core.invoke("open_url_external", { url: ev.url }).catch(e => {
            console.error("[live] open_url_external failed:", e);
          });
        } else {
          window.open(ev.url, "_blank");
        }
        if (ev.instructions) {
          state.messages = [
            ...state.messages,
            window.NoticeBubble.make(ev.instructions, window.timeNow(), state.model?.name ?? null),
          ];
          notify();
        }
        return;
      }
      // Free text / code prompts: an "Other" follow-up (auto-answered), an OAuth/login
      // prompt (blocking window.prompt, as before) or an inline field of an ask form.
      if (ev.method === "input" || ev.method === "editor") {
        const reply = window.AskAnswer.resolveHandshake(handshake, ev);
        if (reply) {
          handshake = null;
          send({ type: "extension_ui_response", id: ev.id, ...reply });
          return;
        }
        if (ev.method === "input" && loginInFlight.has(rt.conn.activeSessionId)) {
          const value = window.prompt(ev.title ?? ev.placeholder ?? "Enter value:");
          if (value !== null) {
            send({ type: "extension_ui_response", id: ev.id, value });
          } else {
            send({ type: "extension_ui_response", id: ev.id, cancelled: true });
          }
          return;
        }
        const t = window.timeNow();
        pushAskBubble(ev.method === "input"
          ? window.AskModel.buildFromInput(ev, t)
          : window.AskModel.buildFromEditor(ev, t));
        return;
      }
      // Agent asks the user to pick from a list. Pushed immediately (every round of a
      // multi-select is a new select); tool_execution_start hoists the ask card above it.
      if (ev.method === "select") {
        // A select means the server did NOT enter input/editor: any armed handshake is stale.
        handshake = null;
        pushAskBubble(window.AskModel.buildFromSelect(ev, window.timeNow()));
        return;
      }
      // Agent cancelled a pending UI request (e.g. turn aborted while waiting for input).
      if (ev.method === "cancel") {
        handshake = null;
        const next = window.AskModel.cancelById(state.messages, ev.targetId);
        if (next !== state.messages) {
          state.messages = next;
          notify();
        }
        return;
      }
      // Dialogs we cannot show — cancel them so the server doesn't hang.
      const NEEDS_RESPONSE = ["confirm"];
      if (NEEDS_RESPONSE.includes(ev.method)) {
        send({ type: "extension_ui_response", id: ev.id, cancelled: true });
      }
    }

    return {
      finalizeAsks, resetHandshake, answerAsk,
      handlers: {
        custom: onCustom,
        extension_ui_request: onExtensionUiRequest,
      },
    };
  }

  window._Live.EventsUi = { create };
})();
