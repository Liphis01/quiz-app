import { useEffect, useRef, useState } from "react";
import {
  exportDatabase,
  importDatabase,
  resetCollection
} from "../../../api/backup";
import { getPackCatalogDiagnostics } from "../../../api/packs";
import { getProfile } from "../../../api/profile";
import {
  getReviewSettings,
  rebalanceReviewCalendar,
  updateReviewSettings
} from "../../../api/review";
import "./Settings.css";
import ReturnToMenuButton from "../../../shared/ReturnToMenuButton";
import SyncAccountSection from "./SyncAccountSection";
import UpdateSection from "./UpdateSection";
import { useSyncAccount } from "./useSyncAccount";

// Bucketed on purpose: the runway carries roughly +/-25% model error and any
// pack import invalidates it, so a precise day count would be false precision.
function runwayLabel(days) {
  if (days == null) return "";
  if (days < 14) return ` — de quoi tenir environ ${days} jours à ce rythme`;
  if (days < 60) return ` — de quoi tenir environ ${Math.round(days / 7)} semaines à ce rythme`;
  return " — de quoi tenir plusieurs mois";
}

const PACE_TIER_LABELS = {
  leger: "Léger",
  regulier: "Régulier",
  soutenu: "Soutenu",
  intensif: "Intensif"
};

// Fallback only: the backend is the source of truth and ships the tiers with
// their time estimates in the settings payload.
const FALLBACK_PACE_TIERS = [
  { key: "leger", daily_target: 10, estimated_minutes: 3 },
  { key: "regulier", daily_target: 20, estimated_minutes: 5 },
  { key: "soutenu", daily_target: 40, estimated_minutes: 10 },
  { key: "intensif", daily_target: 80, estimated_minutes: 20 }
];

function SettingsGroup({
  children,
  icon,
  accent = "",
  title,
  description,
  badge,
  id
}) {
  return (
    <section className="settings-group" id={id}>
      <div className="settings-group-head">
        <span
          className={`settings-section-icon ${
            accent ? `settings-section-icon-${accent}` : ""
          }`}
          aria-hidden="true"
        >
          {icon}
        </span>

        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>

        {badge && <span className="settings-badge">{badge}</span>}
      </div>

      <div className="settings-group-content">{children}</div>
    </section>
  );
}

function syncRailLabel(sync) {
  if (!sync.status) {
    return "Chargement";
  }

  return sync.signedIn ? "Connecté" : "Non connecté";
}

function syncRailCaption(sync, username) {
  if (!sync.status) {
    return "...";
  }

  return sync.signedIn
    ? username || sync.status.account_email || "Compte connecté"
    : "Aucun compte connecté";
}

function SettingsRail({
  loading,
  target,
  tierLabel,
  sync,
  username,
  exporting,
  importing,
  resetting,
  onExport
}) {
  return (
    <aside className="settings-rail app-scrollbar" aria-label="Résumé et raccourcis">
      <div className="settings-rail-card">
        <div className="settings-overline">Sync</div>
        <strong
          className={`settings-rail-sync ${
            sync.signedIn ? "settings-rail-sync-on" : ""
          }`}
        >
          {syncRailLabel(sync)}
        </strong>
        <span>{syncRailCaption(sync, username)}</span>
      </div>

      <div className="settings-rail-card">
        <div className="settings-overline">Objectif actif</div>
        <strong>{loading ? "..." : tierLabel}</strong>
        <span>{loading ? "" : `${target} questions / jour`}</span>
      </div>

      <div className="settings-rail-card settings-rail-shortcuts">
        <div className="settings-overline">Raccourcis</div>

        <div className="settings-rail-actions">
          <button
            type="button"
            onClick={() => sync.doPush(false)}
            disabled={!sync.signedIn || sync.busy}
            className="settings-save"
          >
            {sync.busy ? "..." : "Envoyer vers le cloud"}
          </button>

          <button
            type="button"
            onClick={sync.doPull}
            disabled={!sync.signedIn || sync.busy}
            className="settings-secondary"
          >
            Télécharger du cloud
          </button>

          <button
            type="button"
            onClick={onExport}
            disabled={exporting || importing || resetting}
            className="settings-secondary"
          >
            {exporting ? "Export..." : "Exporter la base"}
          </button>
        </div>
      </div>

      <div className="settings-rail-card settings-rail-note">
        Les sauvegardes locales restent disponibles, mais la synchronisation
        devient l'action principale.
      </div>
    </aside>
  );
}


const CATALOG_DIAGNOSTIC_LABELS = {
  ok: "Prêt",
  warning: "À vérifier",
  error: "Bloqué"
};

const CATALOG_KEY_LABELS = {
  publishable: "clé publishable",
  legacy_jwt: "clé anon",
  secret: "clé secrète",
  unknown: "clé inconnue",
  missing: "clé absente"
};

function CatalogDiagnosticPanel({ diagnostics, checking, error }) {
  if (checking) {
    return (
      <div className="settings-catalog-diagnostic settings-catalog-diagnostic-idle">
        <div className="settings-catalog-diagnostic-head">
          <div>
            <strong>Diagnostic catalogue</strong>
            <span>Vérification en cours...</span>
          </div>
          <span className="settings-catalog-health">Test</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="settings-catalog-diagnostic settings-catalog-diagnostic-error">
        <div className="settings-catalog-diagnostic-head">
          <div>
            <strong>Diagnostic catalogue</strong>
            <span>{error}</span>
          </div>
          <span className="settings-catalog-health">Bloqué</span>
        </div>
      </div>
    );
  }

  if (!diagnostics) {
    return (
      <div className="settings-catalog-diagnostic settings-catalog-diagnostic-idle">
        <div className="settings-catalog-diagnostic-head">
          <div>
            <strong>Diagnostic catalogue</strong>
            <span>Non testé.</span>
          </div>
          <span className="settings-catalog-health">Attente</span>
        </div>
      </div>
    );
  }

  const status = diagnostics.status || "warning";
  const checks = Array.isArray(diagnostics.checks) ? diagnostics.checks : [];
  const samples = Array.isArray(diagnostics.sample_packs)
    ? diagnostics.sample_packs
    : [];
  const total = diagnostics.total || 0;

  return (
    <div className={`settings-catalog-diagnostic settings-catalog-diagnostic-${status}`}>
      <div className="settings-catalog-diagnostic-head">
        <div>
          <strong>Diagnostic catalogue</strong>
          <span>{diagnostics.summary || "Diagnostic terminé."}</span>
        </div>
        <span className="settings-catalog-health">
          {CATALOG_DIAGNOSTIC_LABELS[status] || "État"}
        </span>
      </div>

      <div className="settings-catalog-metrics">
        <span>
          {total} pack{total !== 1 ? "s" : ""} public{total !== 1 ? "s" : ""}
        </span>
        <span>{CATALOG_KEY_LABELS[diagnostics.key_type] || "clé"}</span>
      </div>

      <div className="settings-catalog-checks">
        {checks.map((check) => (
          <div
            key={check.id}
            className={`settings-catalog-check settings-catalog-check-${check.status}`}
          >
            <span className="settings-catalog-dot" aria-hidden="true" />
            <strong>{check.label}</strong>
            <span>{check.detail}</span>
          </div>
        ))}
      </div>

      {samples.length > 0 && (
        <div className="settings-catalog-samples">
          {samples.map((sample) => (
            <span
              key={sample.pack_guid}
              className={`settings-catalog-sample settings-catalog-sample-${sample.download_status}`}
            >
              {sample.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Settings({
  setMode,
  initialSection = null,
  onInitialSectionHandled = null
}) {
  const [target, setTarget] = useState(50);
  const [paceTier, setPaceTier] = useState(null);
  const [paceTiers, setPaceTiers] = useState(FALLBACK_PACE_TIERS);
  const [rateRatio, setRateRatio] = useState(null);
  const [unstartedCount, setUnstartedCount] = useState(null);
  const [runwayDays, setRunwayDays] = useState(null);
  const [lastRetention, setLastRetention] = useState(null);
  const [resolvedTier, setResolvedTier] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const fileInputRef = useRef(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [dataStatus, setDataStatus] = useState("");
  const [dataError, setDataError] = useState("");

  const [catalogDiagnostics, setCatalogDiagnostics] = useState(null);
  const [catalogChecking, setCatalogChecking] = useState(false);
  const [catalogDiagnosticError, setCatalogDiagnosticError] = useState("");

  const sync = useSyncAccount();
  const [accountUsername, setAccountUsername] = useState(null);

  useEffect(() => {
    if (!sync.signedIn) {
      setAccountUsername(null);
      return undefined;
    }

    let cancelled = false;

    getProfile()
      .then((profile) => {
        if (!cancelled) {
          setAccountUsername(profile?.profile?.username || null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAccountUsername(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sync.signedIn]);

  useEffect(() => {
    const screen = document.querySelector(".settings-groups");

    if (screen) {
      screen.scrollLeft = 0;
      screen.scrollTop = 0;
    }
  }, []);

  useEffect(() => {
    if (!initialSection) {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(initialSection);

      if (target) {
        target.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }

      onInitialSectionHandled?.();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [initialSection, onInitialSectionHandled]);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError("");
    setStatus("");

    getReviewSettings()
      .then((settings) => {
        if (cancelled) return;

        applySettings(settings);
        setLoading(false);
      })
      .catch((settingsError) => {
        console.error(settingsError);

        if (!cancelled) {
          setError(settingsError.message || "Paramètres impossibles à charger.");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function applySettings(settings) {
    setTarget(settings.catchup_daily_target || 50);
    setPaceTier(settings.pace_tier ?? null);
    setRateRatio(settings.rate_ratio ?? null);
    setUnstartedCount(settings.unstarted_count ?? null);
    setRunwayDays(settings.intake_runway_days ?? null);
    setLastRetention(settings.last_retention ?? null);

    if (Array.isArray(settings.pace_tiers) && settings.pace_tiers.length > 0) {
      setPaceTiers(settings.pace_tiers);
    }

    // A user predating the tiers keeps their own number; the picker still
    // highlights the closest tier so the section is not left blank.
    setResolvedTier(settings.pace_tier ?? settings.pace_tier_resolved ?? null);
  }

  async function savePaceTier(tierKey) {
    if (tierKey === paceTier) {
      setStatus("");
      setError("");
      return;
    }

    setSaving(true);
    setError("");
    setStatus("");

    try {
      const settings = await updateReviewSettings({ pace_tier: tierKey });
      applySettings(settings);
      await rebalanceReviewCalendar();
      setStatus("Rythme enregistré. Calendrier rééquilibré.");
    } catch (saveError) {
      console.error(saveError);
      setResolvedTier(paceTier);
      setError(saveError.message || "Paramètres impossibles à enregistrer.");
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    setDataStatus("");
    setDataError("");

    try {
      const filename = await exportDatabase();
      setDataStatus(`Base exportée : ${filename}`);
    } catch (exportError) {
      console.error(exportError);
      setDataError(exportError.message || "Export impossible.");
    } finally {
      setExporting(false);
    }
  }

  function openImportPicker() {
    setDataStatus("");
    setDataError("");
    fileInputRef.current?.click();
  }

  async function handleImportFile(event) {
    const input = event.target;
    const file = input.files && input.files[0];
    // Reset so re-selecting the same file still fires onChange.
    input.value = "";

    if (!file) {
      return;
    }

    const confirmed = window.confirm(
      "Importer cette sauvegarde remplacera TOUTE la base de données et les " +
        "médias actuels. Cette action est irréversible. Continuer ?"
    );

    if (!confirmed) {
      return;
    }

    setImporting(true);
    setDataStatus("");
    setDataError("");

    try {
      await importDatabase(file);
      // The whole database changed under us; reload so every view refetches.
      setDataStatus("Base importée. Rechargement...");
      window.location.reload();
    } catch (importError) {
      console.error(importError);
      setDataError(importError.message || "Import impossible.");
      setImporting(false);
    }
  }

  async function handleReset() {
    const syncWarning = sync.signedIn
      ? " Votre compte est connecté : la prochaine synchronisation enverra " +
        "cette collection vide et remplacera aussi la copie dans le cloud."
      : "";

    const confirmed = window.confirm(
      "Réinitialiser supprimera TOUTES vos questions, vos médias et toute " +
        "votre progression. Une sauvegarde est créée automatiquement avant " +
        "l'effacement, mais l'application repartira de zéro." +
        syncWarning +
        " Continuer ?"
    );

    if (!confirmed) {
      return;
    }

    setResetting(true);
    setDataStatus("");
    setDataError("");

    try {
      await resetCollection();
      // Every view holds questions/progress that no longer exist; reload
      // rather than trying to invalidate them one by one.
      setDataStatus("Collection réinitialisée. Rechargement...");
      window.location.reload();
    } catch (resetError) {
      console.error(resetError);
      setDataError(resetError.message || "Réinitialisation impossible.");
      setResetting(false);
    }
  }

  async function runCatalogDiagnostics() {
    setCatalogChecking(true);
    setCatalogDiagnosticError("");

    try {
      const diagnostics = await getPackCatalogDiagnostics();
      setCatalogDiagnostics(diagnostics);
    } catch (diagnosticError) {
      console.error(diagnosticError);
      setCatalogDiagnostics(null);
      setCatalogDiagnosticError(
        diagnosticError.message || "Diagnostic impossible."
      );
    } finally {
      setCatalogChecking(false);
    }
  }

  return (
    <div className="settings-screen">
      <div className="settings-shell">
        <header className="settings-header">
          <div className="settings-brand-row">
            <div className="settings-brand-mark" aria-hidden="true">
              N
            </div>

            <div className="settings-title-block">
              <div className="settings-overline">Nemoris</div>
              <h1>Paramètres</h1>
              <p>Préférences, synchronisation et sauvegardes.</p>
            </div>
          </div>

          <ReturnToMenuButton
            onClick={() => setMode("menu")}
            className="settings-back"
          />
        </header>

        <div className="settings-layout">
          <SettingsRail
            loading={loading}
            target={target}
            tierLabel={
              resolvedTier
                ? PACE_TIER_LABELS[resolvedTier] || resolvedTier
                : "Personnalisé"
            }
            sync={sync}
            username={accountUsername}
            exporting={exporting}
            importing={importing}
            resetting={resetting}
            onExport={handleExport}
          />

          <main className="settings-groups app-scrollbar" aria-label="Paramètres">
            <SyncAccountSection sync={sync} username={accountUsername} />

            <SettingsGroup
              id="settings-review"
              icon="↻"
              accent="amber"
              title="Review"
              description="Rythme quotidien"
              badge={loading ? "..." : `${target} / jour`}
            >
              {loading ? (
                <div className="settings-loading">
                  Chargement des paramètres...
                </div>
              ) : (
                <div className="settings-row settings-row-stacked">
                  <div className="settings-row-copy">
                    <strong>Rythme quotidien</strong>
                    <span>
                      Volume visé chaque jour, révisions et nouvelles questions
                      comprises. Le rythme s'ajuste ensuite tout seul selon tes
                      résultats.
                    </span>
                  </div>

                  <div
                    className="settings-pace-tiers"
                    role="radiogroup"
                    aria-label="Rythme quotidien"
                  >
                    {paceTiers.map((tier) => (
                      <button
                        key={tier.key}
                        type="button"
                        role="radio"
                        aria-checked={tier.key === resolvedTier}
                        disabled={saving}
                        onClick={() => savePaceTier(tier.key)}
                        className={`settings-pace-tier${
                          tier.key === resolvedTier
                            ? " settings-pace-tier-active"
                            : ""
                        }`}
                      >
                        <strong>{PACE_TIER_LABELS[tier.key] || tier.key}</strong>
                        <span>{tier.daily_target} questions</span>
                        <span className="settings-pace-tier-time">
                          ~{tier.estimated_minutes} min
                        </span>
                        {tier.new_max != null && (
                          <span className="settings-pace-tier-projection">
                            jusqu'à {tier.new_max} nouvelles / jour
                          </span>
                        )}
                      </button>
                    ))}
                  </div>

                  <p className="settings-pace-note">
                    Tes révisions programmées passent toujours en premier. Le
                    palier dit combien de questions en plus tu veux : les
                    nouvelles complètent ta journée jusqu'à ce volume, sans
                    jamais descendre sous le minimum du palier.
                  </p>

                  {!paceTier && (
                    <p className="settings-pace-note">
                      Rythme personnalisé : {target} questions / jour. Choisis un
                      palier pour le remplacer.
                    </p>
                  )}

                  {rateRatio !== null && rateRatio !== 1 && (
                    <p className="settings-pace-note">
                      {rateRatio < 1
                        ? `Nouvelles questions réduites à ${Math.round(rateRatio * 100)} % pour l'instant`
                        : `Ton calendrier a de la marge : tu reçois ${Math.round(rateRatio * 100)} % des nouvelles questions prévues par ton palier`}
                      {lastRetention !== null
                        ? ` (${Math.round(lastRetention)} % de réussite sur 30 jours)`
                        : ""}
                      . Tes révisions programmées, elles, ne changent pas.
                    </p>
                  )}

                  {unstartedCount !== null && (
                    <p className="settings-pace-note">
                      {unstartedCount > 0
                        ? `Réserve : ${unstartedCount} questions jamais vues${runwayLabel(runwayDays)}.`
                        : "Réserve épuisée : tes sessions ne contiennent plus que des révisions. Importe un pack pour repartir sur du nouveau."}
                    </p>
                  )}
                </div>
              )}

              {status && (
                <div className="settings-status" role="status">
                  {status}
                </div>
              )}

              {error && (
                <div role="alert" className="settings-alert">
                  {error}
                </div>
              )}
            </SettingsGroup>

            <SettingsGroup
              id="settings-data"
              icon="⇣"
              accent="green"
              title="Données"
              description="Sauvegarde, restauration et remise à zéro"
              badge="3 actions"
            >
              <div className="settings-row">
                <div className="settings-row-copy">
                  <strong>Exporter la base</strong>
                  <span>
                    Questions, progression et médias dans une archive ZIP.
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleExport}
                  disabled={exporting || importing || resetting}
                  className="settings-secondary"
                >
                  {exporting ? "Export..." : "Exporter"}
                </button>
              </div>

              <div className="settings-row settings-row-danger">
                <div className="settings-row-copy">
                  <strong>Importer une sauvegarde</strong>
                  <span>
                    Remplace toutes les données locales après confirmation.
                  </span>
                </div>

                <button
                  type="button"
                  onClick={openImportPicker}
                  disabled={exporting || importing || resetting}
                  className="settings-danger"
                >
                  {importing ? "Import..." : "Importer"}
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip"
                  aria-label="Importer la base"
                  className="settings-file-input"
                  onChange={handleImportFile}
                />
              </div>

              <div className="settings-row settings-row-danger">
                <div className="settings-row-copy">
                  <strong>Réinitialiser ma collection</strong>
                  <span>
                    Efface toutes les questions, médias et progressions pour
                    repartir à zéro. Une sauvegarde est créée avant l'effacement.
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleReset}
                  disabled={exporting || importing || resetting}
                  className="settings-danger"
                >
                  {resetting ? "Réinitialisation..." : "Réinitialiser"}
                </button>
              </div>

              {dataStatus && (
                <div className="settings-status" role="status">
                  {dataStatus}
                </div>
              )}

              {dataError && (
                <div role="alert" className="settings-alert">
                  {dataError}
                </div>
              )}
            </SettingsGroup>

            <SettingsGroup
              id="settings-packs"
              icon="▣"
              accent="violet"
              title="Packs"
              description="Catalogue de packs partagés"
            >
              <div className="settings-row settings-row-catalog">
                <div className="settings-row-copy">
                  <strong>Catalogue Nemoris</strong>
                  <span>
                    Le catalogue utilisé par l'écran Packs. Lance un test si
                    les packs ne se chargent pas.
                  </span>
                </div>

                <div className="settings-actions settings-row-actions">
                  <button
                    type="button"
                    onClick={runCatalogDiagnostics}
                    disabled={catalogChecking}
                    aria-label="Tester le catalogue"
                    className="settings-secondary"
                  >
                    {catalogChecking ? "Test..." : "Tester"}
                  </button>
                </div>
              </div>

              <CatalogDiagnosticPanel
                diagnostics={catalogDiagnostics}
                checking={catalogChecking}
                error={catalogDiagnosticError}
              />
            </SettingsGroup>

            <UpdateSection />
          </main>
        </div>
      </div>
    </div>
  );
}
