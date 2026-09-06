import { useEffect, useMemo, useRef, useState } from "react";
import ReturnToMenuButton from "../../../shared/ReturnToMenuButton";
import {
  getPackTypeChipStyle,
  getQuestionTypeChipStyle,
  packTypeChipStyles
} from "../../../shared/questionTypes";
import { getStudySummary } from "../../../api/study";
import {
  createPackVariantSource,
  fetchPackPreview,
  getPackFamily,
  listPackSuggestedEditTargets,
  listPackActivity,
  markPackActivityRead,
  submitPackSuggestedEdit
} from "../../../api/packs";
import {
  numberLabel,
  questionCountLabel,
  recommendationFor
} from "../../study/studyRecommendation";
import {
  POPULAR_THEME,
  useBrowsePacks
} from "../hooks/useBrowsePacks";
import { usePackPublishAuth } from "../hooks/usePackPublishAuth";
import PackCard from "./PackCard";
import PackReviewsSection from "./PackReviewsSection";
import UnplacedTagRootsDialog from "./UnplacedTagRootsDialog";
import PublicationsManager from "./PublicationsManager";
import { formatSize } from "./packFormatting";
import "./BrowsePacks.css";

const PROGRESS_BUCKETS = [
  { key: "mastered", label: "Maîtrisé" },
  { key: "stable", label: "Stable" },
  { key: "fragile", label: "Fragile" },
  { key: "learning", label: "Apprentissage" },
  { key: "unseen", label: "Nouveau" }
];

const STATUS_FILTERS = [
  { value: "all", label: "Tous statuts" },
  { value: "not_installed", label: "À installer" },
  { value: "update_available", label: "Mises à jour" },
  { value: "up_to_date", label: "À jour" },
  { value: "local_copy", label: "Déjà présents" }
];

const TYPE_FILTERS = [
  { value: "all", label: "Tous types" },
  ...Object.entries(packTypeChipStyles).map(([value, style]) => ({
    value,
    label: style.label
  }))
];

const SORT_OPTIONS = [
  { value: "pertinence", label: "Pertinence" },
  { value: "populaires", label: "Populaires" },
  { value: "note", label: "Mieux notés" },
  { value: "récents", label: "Récents" },
  { value: "nom", label: "Nom" },
  { value: "questions", label: "Questions" }
];

function statusLabel(status) {
  if (status === "local_copy") {
    return "Déjà présent";
  }

  if (status === "update_available") {
    return "Changements disponibles";
  }

  if (status === "up_to_date") {
    return "Installé";
  }

  return "À installer";
}

function statusClassName(status) {
  if (status === "update_available") return "pack-status-pill-update";
  if (status === "not_installed") return "pack-status-pill-install";
  if (status === "local_copy") return "pack-status-pill-local";
  return "";
}

function StatePanel({ children, title }) {
  return (
    <div className="pack-state-panel">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

function FieldSelect({ label, value, options, onChange }) {
  return (
    <label className="pack-toolbar-field">
      <span className="pack-field-label">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SearchToolbar({
  searchDraft,
  setSearchDraft,
  sort,
  setSort,
  statusFilter,
  setStatusFilter,
  typeFilter,
  setTypeFilter
}) {
  return (
    <div className="pack-search-toolbar">
      <label className="pack-toolbar-search">
        <span className="pack-field-label">Recherche</span>
        <span className="pack-search-symbol" aria-hidden="true">⌕</span>
        <input
          aria-label="Rechercher un pack"
          type="search"
          placeholder="Titre, thème, licence..."
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
        />
      </label>

      <FieldSelect
        label="Type"
        value={typeFilter}
        options={TYPE_FILTERS}
        onChange={setTypeFilter}
      />
      <FieldSelect
        label="Statut"
        value={statusFilter}
        options={STATUS_FILTERS}
        onChange={setStatusFilter}
      />
      <FieldSelect
        label="Tri"
        value={sort}
        options={SORT_OPTIONS}
        onChange={setSort}
      />
    </div>
  );
}

function ThemeRail({ activeTheme, loading, onSelectTheme, themes }) {
  return (
    <aside className="pack-theme-panel app-scrollbar" aria-label="Thèmes">
      <div className="pack-section-head">
        <div>
          <h2>Thèmes</h2>
          <p>{themes.length} entrée{themes.length > 1 ? "s" : ""}</p>
        </div>
      </div>

      <div className="pack-theme-list">
        {themes.map((theme) => {
          const active = activeTheme === theme.value;

          return (
            <button
              key={theme.value}
              type="button"
              className={`pack-theme-button${active ? " is-active" : ""}`}
              onClick={() => onSelectTheme(theme.value)}
              aria-pressed={active}
            >
              <span>{theme.label}</span>
              {theme.result_count !== null && theme.result_count !== undefined && (
                <strong>{theme.result_count}</strong>
              )}
            </button>
          );
        })}

        {!loading && themes.length === 0 && (
          <div className="pack-theme-empty">
            Aucun thème disponible.
          </div>
        )}
      </div>
    </aside>
  );
}

function CatalogueState({ error, loading, reload }) {
  if (loading) {
    return (
      <StatePanel title="Chargement du catalogue">
        <p>Recherche dans le catalogue.</p>
      </StatePanel>
    );
  }

  if (error) {
    return (
      <StatePanel title="Catalogue indisponible">
        <p role="alert">{error}</p>
        <button
          type="button"
          className="pack-secondary-button"
          onClick={reload}
        >
          Réessayer
        </button>
      </StatePanel>
    );
  }

  return null;
}

function estimatedTimeLabel(minutes) {
  const value = Number(minutes || 0);

  if (!value) return null;

  if (value < 60) return `~${value} min`;

  const hours = Math.floor(value / 60);
  const rest = value % 60;

  return rest ? `~${hours} h ${String(rest).padStart(2, "0")}` : `~${hours} h`;
}


function PackChipGroup({ label, values }) {
  if (!values || values.length === 0) return null;

  return (
    <div className="pack-detail-chip-group">
      <span className="pack-detail-chip-label">{label}</span>
      <div className="pack-chip-row">
        {values.map((value) => (
          <span className="pack-chip" key={value}>{value}</span>
        ))}
      </div>
    </div>
  );
}


function familyBadgeLabel(entry, family) {
  if (entry.pack_guid === family?.original_pack_guid) {
    return "Original";
  }

  if (entry.pack_guid === family?.recommended_pack_guid) {
    return "Recommandé";
  }

  return "Variante";
}


function suggestedEditTargetLabel(target, index) {
  const source = target.question || target.answer || `Question ${index + 1}`;
  const prefix = target.group_name ? `${target.group_name} · ` : "";

  return `${prefix}${source}`;
}


function activityTitle(event) {
  if (event.event_type === "suggested_edit_created") {
    return event.payload?.target_label || "Suggestion de correction";
  }

  return event.related_pack_name || "Nouvelle variante";
}


function activityAuthorLabel(event) {
  return String(event.payload?.author_label || "").trim() || "Utilisateur";
}


function activityDetail(event) {
  if (event.event_type === "suggested_edit_created") {
    return `${activityAuthorLabel(event)} propose une correction pour ${
      event.pack_name || event.pack_guid || "ton pack"
    }`;
  }

  return `Variante de ${event.pack_name || event.pack_guid || "ton pack"}`;
}


function PackFamilyPanel({ entry, onSelectEntry, selectedPackGuid }) {
  const [state, setState] = useState({
    status: "idle",
    data: null,
    error: ""
  });

  useEffect(() => {
    let cancelled = false;

    setState({ status: "loading", data: null, error: "" });
    getPackFamily(entry.pack_guid)
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data, error: "" });
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          setState({
            status: "error",
            data: null,
            error: error.message || "Famille indisponible."
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [entry.pack_guid]);

  const packs = state.data?.packs || [];
  const shouldShow = (
    entry.variant_of_pack_guid ||
    entry.variant_count > 0 ||
    packs.length > 1
  );

  if (!shouldShow && state.status !== "loading") {
    return null;
  }

  return (
    <div className="pack-family-panel">
      <div className="pack-section-head">
        <div>
          <h3>Famille</h3>
          <p>
            {state.status === "ready"
              ? `${packs.length} pack${packs.length > 1 ? "s" : ""}`
              : "Chargement"}
          </p>
        </div>
      </div>

      {state.status === "loading" && (
        <div className="pack-status" role="status">Chargement de la famille...</div>
      )}

      {state.status === "error" && (
        <div className="pack-alert" role="alert">{state.error}</div>
      )}

      {state.status === "ready" && packs.length > 0 && (
        <div className="pack-family-list">
          {packs.map((familyEntry) => {
            const active = familyEntry.pack_guid === selectedPackGuid;
            const recommended = (
              familyEntry.pack_guid === state.data.recommended_pack_guid
            );

            return (
              <button
                key={familyEntry.pack_guid}
                type="button"
                className={`pack-family-item${active ? " is-active" : ""}${recommended ? " is-recommended" : ""}`}
                onClick={() => onSelectEntry(familyEntry)}
                aria-pressed={active}
              >
                <span>
                  <strong>{familyEntry.name}</strong>
                  <small>
                    {questionCountLabel(familyEntry.question_count)}
                    {familyEntry.avg_rating ? ` · ${familyEntry.avg_rating}/5` : ""}
                  </small>
                </span>
                <em>{familyBadgeLabel(familyEntry, state.data)}</em>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}


function PackActivityMenu() {
  const [state, setState] = useState({
    status: "loading",
    events: [],
    unreadCount: 0,
    error: ""
  });
  const [open, setOpen] = useState(false);
  const [marking, setMarking] = useState(false);

  function loadActivity() {
    listPackActivity({ limit: 20 })
      .then((data) => {
        setState({
          status: "ready",
          events: Array.isArray(data.events) ? data.events : [],
          unreadCount: data.unread_count || 0,
          error: ""
        });
      })
      .catch((error) => {
        if (error.status === 401) {
          setState({ status: "signed_out", events: [], unreadCount: 0, error: "" });
          return;
        }

        console.error(error);
        setState({
          status: "error",
          events: [],
          unreadCount: 0,
          error: error.message || "Activité indisponible."
        });
      });
  }

  useEffect(() => {
    loadActivity();
  }, []);

  async function markRead() {
    setMarking(true);

    try {
      await markPackActivityRead(
        state.events
          .filter((event) => !event.read_at)
          .map((event) => event.id)
      );
      loadActivity();
    } catch (error) {
      console.error(error);
      setState((current) => ({
        ...current,
        error: error.message || "Lecture impossible."
      }));
    } finally {
      setMarking(false);
    }
  }

  if (state.status === "signed_out") {
    return null;
  }

  return (
    <div className="pack-activity">
      <button
        type="button"
        className="pack-secondary-button pack-activity-button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        Activité
        {state.unreadCount > 0 && (
          <span>{state.unreadCount}</span>
        )}
      </button>

      {open && (
        <div className="pack-activity-popover" role="dialog" aria-label="Activité des packs">
          <div className="pack-section-head">
            <div>
              <h3>Activité</h3>
              <p>{state.unreadCount} non lue{state.unreadCount > 1 ? "s" : ""}</p>
            </div>
          </div>

          {state.status === "loading" && (
            <div className="pack-status" role="status">Chargement...</div>
          )}

          {state.error && (
            <div className="pack-alert" role="alert">{state.error}</div>
          )}

          {state.status === "ready" && state.events.length === 0 && (
            <div className="pack-theme-empty">Aucune activité.</div>
          )}

          {state.status === "ready" && state.events.length > 0 && (
            <div className="pack-activity-list">
              {state.events.map((event) => (
                <div
                  className={`pack-activity-item${event.read_at ? "" : " is-unread"}`}
                  key={event.id}
                >
                  <strong>{activityTitle(event)}</strong>
                  <span>{activityDetail(event)}</span>
                </div>
              ))}
            </div>
          )}

          {state.unreadCount > 0 && (
            <button
              type="button"
              className="pack-secondary-button"
              disabled={marking}
              onClick={markRead}
            >
              {marking ? "..." : "Tout marquer comme lu"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}


function PackPreviewPanel({ entry }) {
  const [state, setState] = useState({ status: "idle", data: null, error: "" });
  const [revealed, setRevealed] = useState(() => new Set());

  function loadPreview() {
    setState({ status: "loading", data: null, error: "" });
    setRevealed(new Set());

    fetchPackPreview(entry.pack_guid, entry.download_url)
      .then((data) => setState({ status: "ready", data, error: "" }))
      .catch((error) => {
        setState({
          status: "error",
          data: null,
          error: error.message || "Aperçu impossible."
        });
      });
  }

  function toggleReveal(index) {
    setRevealed((current) => {
      const next = new Set(current);

      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }

      return next;
    });
  }

  if (state.status === "idle") {
    return (
      <div className="pack-preview-panel">
        <button
          type="button"
          className="pack-secondary-button"
          disabled={!entry.download_url}
          onClick={loadPreview}
        >
          Voir un aperçu
        </button>
      </div>
    );
  }

  const itemTypes = state.data?.item_types || [];

  return (
    <div className="pack-preview-panel">
      <div className="pack-section-head">
        <div>
          <h3>Aperçu</h3>
          {itemTypes.length > 0 && (
            <p>
              {itemTypes
                .map((typeEntry) => `${getQuestionTypeChipStyle(typeEntry.type_q).label} × ${typeEntry.count}`)
                .join(" · ")}
            </p>
          )}
        </div>
      </div>

      {state.status === "loading" && (
        <div className="pack-status" role="status">Chargement de l'aperçu...</div>
      )}

      {state.status === "error" && (
        <div className="pack-alert" role="alert">{state.error}</div>
      )}

      {state.status === "ready" && (
        <ul className="pack-preview-list">
          {state.data.samples.map((sample, index) => (
            <li className="pack-preview-item" key={index}>
              <span className="pack-preview-question">{sample.question}</span>
              <button
                type="button"
                className="pack-preview-answer-toggle"
                onClick={() => toggleReveal(index)}
              >
                {revealed.has(index) ? sample.answer : "Révéler la réponse"}
              </button>
            </li>
          ))}
          {state.data.truncated && (
            <li className="pack-preview-more">
              + {numberLabel(state.data.question_count - state.data.sample_count)} autres questions
            </li>
          )}
        </ul>
      )}
    </div>
  );
}


function PackProgressPanel({ entry }) {
  const [state, setState] = useState({
    status: "loading",
    summary: null,
    error: ""
  });

  useEffect(() => {
    let cancelled = false;

    setState({ status: "loading", summary: null, error: "" });

    getStudySummary({ type: "pack", packGuid: entry.pack_guid })
      .then((summary) => {
        if (!cancelled) setState({ status: "ready", summary, error: "" });
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            status: "error",
            summary: null,
            error: error.message || "Progression indisponible."
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [entry.pack_guid]);

  if (state.status === "loading") {
    return (
      <div className="pack-progress-panel">
        <div className="pack-status" role="status">Chargement de la progression...</div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="pack-progress-panel">
        <div className="pack-alert" role="alert">{state.error}</div>
      </div>
    );
  }

  const summary = state.summary;
  const counts = summary.counts || {};
  const buckets = summary.buckets || {};
  const total = Math.max(1, counts.active_questions || 0);
  const recommendation = recommendationFor(summary);

  return (
    <div className="pack-progress-panel">
      <div className="pack-section-head">
        <div>
          <h3>Progression installée</h3>
          <p>{questionCountLabel(counts.total_atomic_questions)}</p>
        </div>
      </div>

      <div className="pack-progress-bars">
        {PROGRESS_BUCKETS.map((bucket) => {
          const value = buckets[bucket.key] || 0;
          const percent = Math.round((value / total) * 100);

          return (
            <div className="pack-progress-row" key={bucket.key}>
              <span>{bucket.label}</span>
              <div className="pack-progress-bar" aria-hidden="true">
                <span style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }} />
              </div>
              <strong>{numberLabel(value)}</strong>
            </div>
          );
        })}
      </div>

      <div className="pack-recommendation">
        <span>Prochaine action</span>
        <strong>{recommendation.title}</strong>
        <span>{recommendation.detail}</span>
      </div>
    </div>
  );
}


function PackSuggestedEditPanel({ entry, canSuggest }) {
  const [open, setOpen] = useState(false);
  const [targetsState, setTargetsState] = useState({
    status: "idle",
    targets: [],
    error: ""
  });
  const [targetGuid, setTargetGuid] = useState("");
  const [proposedQuestion, setProposedQuestion] = useState("");
  const [proposedAnswer, setProposedAnswer] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [sent, setSent] = useState(false);
  const targetsRequestIdRef = useRef(0);

  useEffect(() => {
    targetsRequestIdRef.current += 1;
    setOpen(false);
    setTargetsState({ status: "idle", targets: [], error: "" });
    setTargetGuid("");
    setProposedQuestion("");
    setProposedAnswer("");
    setNote("");
    setSubmitError("");
    setSent(false);
  }, [entry.pack_guid]);

  async function loadTargets() {
    const requestId = targetsRequestIdRef.current + 1;
    targetsRequestIdRef.current = requestId;

    setTargetsState({ status: "loading", targets: [], error: "" });

    try {
      const data = await listPackSuggestedEditTargets(entry.pack_guid);
      if (targetsRequestIdRef.current === requestId) {
        setTargetsState({
          status: "ready",
          targets: Array.isArray(data.targets) ? data.targets : [],
          error: ""
        });
      }
    } catch (error) {
      console.error(error);
      if (targetsRequestIdRef.current === requestId) {
        setTargetsState({
          status: "error",
          targets: [],
          error: error.message || "Questions indisponibles."
        });
      }
    }
  }

  function handleToggleOpen() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && targetsState.status === "idle") {
      void loadTargets();
    }
  }

  if (!canSuggest) {
    return null;
  }

  const selectedTarget = targetsState.targets.find(
    (target) => target.question_guid === targetGuid
  );
  const hasPayload = (
    note.trim() ||
    proposedQuestion.trim() ||
    proposedAnswer.trim()
  );

  async function handleSubmit(event) {
    event.preventDefault();

    if (!note.trim() || busy) {
      return;
    }

    setBusy(true);
    setSubmitError("");
    setSent(false);

    try {
      await submitPackSuggestedEdit(entry.pack_guid, {
        target_question_guid: targetGuid || null,
        proposed_question: proposedQuestion.trim(),
        proposed_answer: proposedAnswer.trim(),
        note: note.trim()
      });
      setTargetGuid("");
      setProposedQuestion("");
      setProposedAnswer("");
      setNote("");
      setSent(true);
    } catch (error) {
      console.error(error);
      setSubmitError(error.message || "Suggestion impossible à envoyer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pack-suggest-edit">
      <button
        type="button"
        className="pack-secondary-button"
        onClick={handleToggleOpen}
        aria-expanded={open}
      >
        Suggérer une correction
      </button>

      {open && (
        <form className="pack-suggest-edit-form" onSubmit={handleSubmit}>
          <label className="pack-field">
            <span className="pack-field-label">Question concernée</span>
            <select
              value={targetGuid}
              disabled={busy}
              onChange={(event) => setTargetGuid(event.target.value)}
            >
              <option value="">Pack entier</option>
              {targetsState.targets.map((target, index) => (
                <option key={target.question_guid} value={target.question_guid}>
                  {suggestedEditTargetLabel(target, index)}
                </option>
              ))}
            </select>
          </label>

          {targetsState.status === "loading" && (
            <div className="pack-status" role="status">Chargement des questions...</div>
          )}

          {targetsState.error && (
            <div className="pack-alert" role="alert">{targetsState.error}</div>
          )}

          {selectedTarget && (
            <div className="pack-suggest-current">
              <span className="pack-field-label">Actuel</span>
              <strong>{selectedTarget.question || "Question sans texte"}</strong>
              {selectedTarget.answer && <span>{selectedTarget.answer}</span>}
            </div>
          )}

          <label className="pack-field">
            <span className="pack-field-label">Question proposée</span>
            <textarea
              value={proposedQuestion}
              disabled={busy}
              placeholder="Laisse vide si elle ne change pas"
              onChange={(event) => setProposedQuestion(event.target.value)}
            />
          </label>

          <label className="pack-field">
            <span className="pack-field-label">Réponse proposée</span>
            <textarea
              value={proposedAnswer}
              disabled={busy}
              placeholder="Laisse vide si elle ne change pas"
              onChange={(event) => setProposedAnswer(event.target.value)}
            />
          </label>

          <label className="pack-field">
            <span className="pack-field-label">Note</span>
            <textarea
              value={note}
              disabled={busy}
              placeholder="Explique la correction"
              required
              onChange={(event) => setNote(event.target.value)}
            />
          </label>

          <div className="pack-action-row">
            <button
              type="submit"
              className="pack-primary-button"
              disabled={busy || !hasPayload || !note.trim()}
            >
              {busy ? "Envoi..." : "Envoyer"}
            </button>
            <button
              type="button"
              className="pack-secondary-button"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Fermer
            </button>
          </div>

          {sent && (
            <div className="pack-status" role="status">Suggestion envoyée.</div>
          )}

          {submitError && (
            <div className="pack-alert" role="alert">{submitError}</div>
          )}
        </form>
      )}
    </section>
  );
}


function PackDetailPanel({
  auth,
  item,
  onCreateVariant,
  onInstall,
  onOpenGroup,
  onOpenStudy,
  onSelectFamilyEntry,
  onUnsubscribe,
  onUpdate,
  setMode,
  variantBusy = false,
  variantError = ""
}) {
  if (!item) {
    return (
      <aside className="pack-detail-panel pack-detail-empty">
        Sélectionne un pack.
      </aside>
    );
  }

  const {
    entry,
    status,
    isMine,
    localGroupId,
    action
  } = item;
  const typeStyle = getPackTypeChipStyle(entry.type_group);
  const sizeLabel = formatSize(entry.size_bytes);
  const canUnsubscribe = (
    status === "up_to_date" || status === "update_available"
  );
  const canOpenGroup = Boolean(localGroupId && onOpenGroup);
  const canOpenStudy = Boolean(canUnsubscribe && entry.pack_guid && onOpenStudy);
  const canCreateVariant = Boolean(
    canUnsubscribe &&
    !isMine &&
    auth?.publishStatus?.signed_in &&
    onCreateVariant
  );
  const canSuggestEdit = Boolean(
    canUnsubscribe &&
    !isMine &&
    auth?.publishStatus?.signed_in
  );

  return (
    <aside className="pack-detail-panel app-scrollbar" aria-label="Détail du pack">
      <div className="pack-card-topline">
        <span
          className="pack-type-chip"
          style={{
            "--pack-type-bg": typeStyle.background,
            "--pack-type-color": typeStyle.color
          }}
        >
          {typeStyle.label}
        </span>
        <span className="pack-card-pill-row">
          {isMine && (
            <span className="pack-status-pill pack-status-pill-owned">
              Mon pack
            </span>
          )}
          <span className={`pack-status-pill ${statusClassName(status)}`}>
            {statusLabel(status)}
          </span>
        </span>
      </div>

      <div>
        <h2>{entry.name}</h2>
        {entry.description && (
          <p className="pack-detail-description">{entry.description}</p>
        )}
      </div>

      <div className="pack-detail-stat-grid">
        <div className="pack-detail-stat">
          <span>Questions</span>
          <strong>{entry.question_count ?? "—"}</strong>
        </div>
        <div className="pack-detail-stat">
          <span>Téléchargements</span>
          <strong>{entry.download_count?.toLocaleString("fr-FR") ?? "—"}</strong>
        </div>
        <div className="pack-detail-stat">
          <span>Taille</span>
          <strong>{sizeLabel || "—"}</strong>
        </div>
        <div className="pack-detail-stat">
          <span>Licence</span>
          <strong>{entry.license || "—"}</strong>
        </div>
        <div className="pack-detail-stat">
          <span>Temps estimé</span>
          <strong>{estimatedTimeLabel(entry.estimated_minutes) || "—"}</strong>
        </div>
      </div>

      <PackChipGroup label="Thèmes" values={entry.themes} />
      <PackChipGroup label="Tags" values={entry.tags} />

      <div className="pack-action-row">
        {status === "not_installed" && (
          <button
            type="button"
            className="pack-primary-button"
            disabled={action.busy}
            onClick={() => onInstall(entry)}
          >
            {action.busy ? "Import..." : "Installer"}
          </button>
        )}

        {status === "update_available" && (
          <button
            type="button"
            className="pack-primary-button"
            disabled={action.busy}
            onClick={() => onUpdate(entry, { deleteRemoved: false })}
          >
            {action.busy ? "Mise à jour..." : "Mettre à jour"}
          </button>
        )}

        {canOpenGroup && (
          <button
            type="button"
            className="pack-secondary-button"
            disabled={action.busy}
            onClick={() => onOpenGroup(localGroupId)}
          >
            Ouvrir dans le gestionnaire ↗
          </button>
        )}

        {canOpenStudy && (
          <button
            type="button"
            className="pack-secondary-button pack-study-button"
            disabled={action.busy}
            onClick={() => onOpenStudy({
              type: "pack",
              packGuid: entry.pack_guid,
              name: entry.name
            })}
          >
            Étudier ce pack
          </button>
        )}

        {canCreateVariant && (
          <button
            type="button"
            className="pack-secondary-button"
            disabled={action.busy || variantBusy}
            onClick={() => onCreateVariant(item)}
          >
            {variantBusy ? "Création..." : "Créer une variante"}
          </button>
        )}

        {canUnsubscribe && (
          <button
            type="button"
            className="pack-secondary-button"
            disabled={action.busy}
            onClick={() => onUnsubscribe(entry.pack_guid)}
          >
            Se désabonner
          </button>
        )}

        {canUnsubscribe && (
          <button
            type="button"
            className="pack-danger-button"
            disabled={action.busy}
            onClick={() => {
              const confirmed = window.confirm(
                `Supprimer « ${entry.name} » et toutes ses questions ? ` +
                "Une sauvegarde est créée automatiquement, mais le pack et " +
                "sa progression disparaissent immédiatement d'ici."
              );

              if (confirmed) {
                onUnsubscribe(entry.pack_guid, { deleteContent: true });
              }
            }}
          >
            Supprimer
          </button>
        )}
      </div>

      {status === "local_copy" && (
        <div className="pack-status">
          Ce pack existe déjà dans tes groupes locaux.
        </div>
      )}

      {action.error && (
        <div className="pack-alert" role="alert">
          {action.error}
        </div>
      )}

      {variantError && (
        <div className="pack-alert" role="alert">
          {variantError}
        </div>
      )}

      <PackSuggestedEditPanel
        entry={entry}
        canSuggest={canSuggestEdit}
        key={`suggest-${entry.pack_guid}`}
      />

      {canOpenStudy && (
        <PackProgressPanel entry={entry} key={`progress-${entry.pack_guid}`} />
      )}

      <PackFamilyPanel
        entry={entry}
        onSelectEntry={onSelectFamilyEntry}
        selectedPackGuid={entry.pack_guid}
        key={`family-${entry.pack_guid}`}
      />

      <PackPreviewPanel entry={entry} key={`preview-${entry.pack_guid}`} />

      <PackReviewsSection entry={entry} isOwner={isMine} setMode={setMode} />
    </aside>
  );
}

function ImporterScreen({
  initialPackGuid,
  initialSearch,
  onInitialPackHandled,
  onOpenGroup,
  onOpenStudy,
  onVariantSourceCreated,
  setMode
}) {
  const auth = usePackPublishAuth();
  const [activeTheme, setActiveTheme] = useState(POPULAR_THEME);
  const [searchDraft, setSearchDraft] = useState(initialSearch || "");
  const [search, setSearch] = useState((initialSearch || "").trim());
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState(initialPackGuid ? "populaires" : "pertinence");
  const [activeGuid, setActiveGuid] = useState(initialPackGuid || null);
  const [familySelectedEntry, setFamilySelectedEntry] = useState(null);
  const [variantBusyGuid, setVariantBusyGuid] = useState(null);
  const [variantError, setVariantError] = useState("");

  useEffect(() => {
    if (!initialPackGuid && !initialSearch) {
      return;
    }

    setActiveTheme(POPULAR_THEME);
    setSearchDraft(initialSearch || "");
    setSearch((initialSearch || "").trim());
    setStatusFilter("all");
    setSort("populaires");
    setActiveGuid(initialPackGuid || null);
    setFamilySelectedEntry(null);
    onInitialPackHandled?.();
  }, [initialPackGuid, initialSearch, onInitialPackHandled]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchDraft.trim());
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchDraft]);

  const filters = useMemo(() => ({
    search,
    theme: activeTheme,
    type: typeFilter,
    status: statusFilter,
    sort,
    limit: 24
  }), [activeTheme, search, sort, statusFilter, typeFilter]);

  const {
    facets,
    items,
    loading,
    loadingMore,
    error,
    total,
    hasMore,
    reload,
    loadMore,
    install,
    update,
    unsubscribe,
    itemForEntry,
    unplacedTagRoots = [],
    clearUnplacedTagRoots
  } = useBrowsePacks(filters);

  const themes = facets?.themes || [];
  const familySelectedItem = (
    familySelectedEntry && familySelectedEntry.pack_guid === activeGuid
      ? itemForEntry(familySelectedEntry)
      : null
  );
  const activeItem = activeGuid
    ? items.find((item) => item.entry.pack_guid === activeGuid)
    : null;
  const selectedItem = (
    activeItem ||
    familySelectedItem ||
    items[0] ||
    null
  );
  const showStatePanel = loading || Boolean(error);

  async function handleCreateVariant(item) {
    const entry = item.entry;

    setVariantBusyGuid(entry.pack_guid);
    setVariantError("");

    try {
      const source = await createPackVariantSource(entry.pack_guid);
      onVariantSourceCreated?.({
        ...source,
        base_pack_guid: entry.pack_guid,
        base_pack_name: entry.name,
        base_pack: entry
      });
    } catch (error) {
      console.error(error);
      setVariantError(error.message || "Création de variante impossible.");
    } finally {
      setVariantBusyGuid(null);
    }
  }

  return (
    <div className="pack-import-layout">
      {unplacedTagRoots.length > 0 && (
        <UnplacedTagRootsDialog
          roots={unplacedTagRoots}
          onClose={clearUnplacedTagRoots}
        />
      )}

      <ThemeRail
        activeTheme={activeTheme}
        loading={loading}
        onSelectTheme={setActiveTheme}
        themes={themes}
      />

      <section className="pack-panel pack-results-panel app-scrollbar" aria-label="Catalogue">
        <div className="pack-section-head">
          <div>
            <h2>Catalogue</h2>
            <p>
              {loading ? "Chargement" : `${items.length} sur ${total} résultat${total > 1 ? "s" : ""}`}
            </p>
          </div>
          <span className="pack-count-pill">{total}</span>
        </div>

        <SearchToolbar
          searchDraft={searchDraft}
          setSearchDraft={setSearchDraft}
          sort={sort}
          setSort={setSort}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          typeFilter={typeFilter}
          setTypeFilter={setTypeFilter}
        />

        {showStatePanel ? (
          <CatalogueState
            error={error}
            loading={loading}
            reload={reload}
          />
        ) : (
          <>
            {items.length === 0 ? (
              <StatePanel title="Aucun résultat">
                <p>Aucun pack ne correspond à cette recherche.</p>
              </StatePanel>
            ) : (
              <div className="pack-dense-list">
                {items.map((item) => (
                  <PackCard
                    key={item.entry.pack_guid}
                    density="row"
                    item={item}
                    onInstall={install}
                    onOpenGroup={onOpenGroup}
                    onSelect={(nextItem) => {
                      setFamilySelectedEntry(null);
                      setActiveGuid(nextItem.entry.pack_guid);
                    }}
                    onUpdate={update}
                    selected={selectedItem?.entry.pack_guid === item.entry.pack_guid}
                  />
                ))}
              </div>
            )}

            {hasMore && (
              <button
                type="button"
                className="pack-secondary-button pack-load-more"
                disabled={loadingMore}
                onClick={loadMore}
              >
                {loadingMore ? "Chargement..." : "Charger plus"}
              </button>
            )}
          </>
        )}
      </section>

      <PackDetailPanel
        auth={auth}
        item={selectedItem}
        onCreateVariant={handleCreateVariant}
        onInstall={install}
        onOpenGroup={onOpenGroup}
        onOpenStudy={onOpenStudy}
        onSelectFamilyEntry={(entry) => {
          setFamilySelectedEntry(entry);
          setActiveGuid(entry.pack_guid);
        }}
        onUnsubscribe={unsubscribe}
        onUpdate={update}
        setMode={setMode}
        variantBusy={variantBusyGuid === selectedItem?.entry.pack_guid}
        variantError={variantError}
      />
    </div>
  );
}

export default function BrowsePacks({
  setMode,
  onOpenGroup,
  onOpenStudy,
  initialPackGuid = null,
  initialSearch = "",
  onInitialPackHandled = null
}) {
  const [activeTab, setActiveTab] = useState("import");
  const [initialVariantSource, setInitialVariantSource] = useState(null);

  useEffect(() => {
    if (initialPackGuid || initialSearch) {
      setActiveTab("import");
    }
  }, [initialPackGuid, initialSearch]);

  return (
    <div className={`pack-screen pack-layout-dense pack-tab-${activeTab}`}>
      <div className="pack-shell">
        <header className="pack-header" aria-label="Packs">
          <div className="pack-title-row">
            <div className="pack-mark" aria-hidden="true">▣</div>
            <div className="pack-title-block">
              <div className="pack-overline">Catalogue</div>
              <h1>Packs</h1>
              <p>Découvrir des packs partagés et publier les tiens.</p>
            </div>
          </div>

          <div className="pack-header-actions">
            {/*
              Two tabs, not three: publishing and managing what you published
              are the same job, and the old split put a "Publier" button in
              both places.
            */}
            <div className="pack-tab-list" role="tablist" aria-label="Menus Packs">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "import"}
                className={`pack-tab-button${activeTab === "import" ? " is-active" : ""}`}
                onClick={() => setActiveTab("import")}
              >
                Découvrir
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "manage"}
                className={`pack-tab-button${activeTab === "manage" ? " is-active" : ""}`}
                onClick={() => setActiveTab("manage")}
              >
                Publier
              </button>
            </div>

            <PackActivityMenu />

            <ReturnToMenuButton
              onClick={() => setMode("menu")}
              className="pack-back"
            />
          </div>
        </header>

        {activeTab === "import" && (
          <ImporterScreen
            initialPackGuid={initialPackGuid}
            initialSearch={initialSearch}
            onInitialPackHandled={onInitialPackHandled}
            onOpenGroup={onOpenGroup}
            onOpenStudy={onOpenStudy}
            onVariantSourceCreated={(source) => {
              setInitialVariantSource(source);
              setActiveTab("manage");
            }}
            setMode={setMode}
          />
        )}
        {activeTab === "manage" && (
          <PublicationsManager
            initialVariantSource={initialVariantSource}
            onInitialVariantHandled={() => setInitialVariantSource(null)}
            setMode={setMode}
            onOpenGroup={onOpenGroup}
          />
        )}
      </div>
    </div>
  );
}
