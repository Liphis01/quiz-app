import { useSyncAccount } from "./useSyncAccount";

function formatAutoSyncStatus(status) {
  const value = status?.last_auto_sync_status;

  if (!value) {
    return "Jamais exécutée";
  }

  const labels = {
    busy: "En cours",
    conflict: "Conflit",
    error: "Erreur",
    idle: "À jour",
    pulled: "Téléchargée",
    pushed: "Envoyée",
    skipped: "Ignorée"
  };

  const label = labels[value] || value;

  const staleReachabilityFailure =
    value === "skipped" && status?.server_reachable === true;

  if (status?.last_auto_sync_error && !staleReachabilityFailure) {
    return `${label} · ${status.last_auto_sync_error}`;
  }

  return label;
}

function SyncAccountSectionFromHook() {
  const sync = useSyncAccount();

  return <SyncAccountSectionView sync={sync} />;
}

function SyncAccountSectionView({ sync, username }) {
  const status = sync.status || {};
  const serverVersion = sync.serverVersion;
  const serverError = status.server_reachable === false
    ? status.server_error || "Serveur de synchronisation injoignable"
    : "";
  const cloudStatus = serverError
    ? ` · cloud inaccessible : ${serverError}`
    : serverVersion
      ? ` · cloud : v${serverVersion}`
      : "";

  return (
    <section className="settings-group settings-group-sync" id="settings-sync">
      <div className="settings-group-head">
        <span
          className="settings-section-icon settings-section-icon-blue"
          aria-hidden="true"
        >
          ⇄
        </span>

        <div>
          <h2>Synchronisation</h2>
          <p>Compte, cloud et serveur</p>
        </div>

        <span
          className={`settings-badge ${
            sync.signedIn ? "settings-badge-success" : ""
          }`}
        >
          {sync.signedIn ? "Connecté" : "Non connecté"}
        </span>
      </div>

      <div className="settings-group-content">
        {sync.signedIn ? (
          <>
            <div className="settings-row settings-row-priority">
              <div className="settings-row-copy">
                <strong>
                  Connecté en tant que {username || sync.status.account_email}
                </strong>
                <span>
                  Dernière version synchronisée : v
                  {sync.status.last_server_version}
                  {cloudStatus}
                </span>
              </div>

              <div className="settings-actions settings-row-actions">
                <button
                  type="button"
                  aria-label="Envoyer vers le cloud"
                  onClick={() => sync.doPush(false)}
                  disabled={sync.busy}
                  className="settings-save"
                >
                  {sync.busy ? "..." : "Envoyer"}
                </button>

                <button
                  type="button"
                  onClick={sync.doPull}
                  disabled={sync.busy}
                  className="settings-secondary"
                >
                  Télécharger
                </button>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-copy">
                <strong>Synchronisation automatique</strong>
                <span>
                  {sync.status.auto_sync_enabled
                    ? `Active · ${formatAutoSyncStatus(sync.status)}`
                    : "Inactive"}
                </span>
              </div>

              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(sync.status.auto_sync_enabled)}
                  disabled={sync.busy}
                  onChange={(event) =>
                    sync.setAutoSyncEnabled(event.target.checked)
                  }
                />
                <span>Synchronisation automatique</span>
              </label>
            </div>

            {sync.conflict != null && (
              <div role="alert" className="settings-alert">
                La copie cloud est plus récente (v{sync.conflict}).
                Téléchargez-la (écrase cet appareil) ou envoyez quand même
                (écrase le cloud).
                <div className="settings-actions settings-alert-actions">
                  <button
                    type="button"
                    onClick={sync.doPull}
                    disabled={sync.busy}
                    className="settings-secondary"
                  >
                    Télécharger
                  </button>

                  <button
                    type="button"
                    onClick={() => sync.doPush(true)}
                    disabled={sync.busy}
                    className="settings-secondary"
                  >
                    Envoyer quand même
                  </button>
                </div>
              </div>
            )}

            <div className="settings-danger-zone">
              <p>
                Les données cloud sont une copie de tes questions, ta
                progression et tes médias. Elles ne sont pas partagées avec
                d'autres comptes.
              </p>

              <div className="settings-actions">
                <button
                  type="button"
                  onClick={sync.signOut}
                  disabled={sync.busy}
                  className="settings-secondary"
                >
                  Se déconnecter
                </button>

                <button
                  type="button"
                  onClick={sync.deleteCloudData}
                  disabled={sync.busy}
                  className="settings-danger"
                >
                  Supprimer mes données cloud
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="settings-row">
              <div className="settings-row-copy">
                <strong>Connexion</strong>
                <span>Connecte ce poste pour envoyer ou télécharger le cloud.</span>
              </div>

              {sync.step === "email" ? (
                <div className="settings-auth-row">
                  <input
                    aria-label="E-mail du compte"
                    type="email"
                    value={sync.email}
                    disabled={sync.busy}
                    placeholder="vous@exemple.com"
                    onChange={(event) => sync.setEmail(event.target.value)}
                    className="settings-input settings-input-wide"
                  />

                  <button
                    type="button"
                    onClick={sync.sendCode}
                    disabled={sync.busy || !sync.email.trim()}
                    className="settings-save"
                  >
                    {sync.busy ? "..." : "Recevoir un code"}
                  </button>
                </div>
              ) : (
                <div className="settings-auth-row">
                  <input
                    aria-label="Code de connexion"
                    type="text"
                    value={sync.code}
                    disabled={sync.busy}
                    onChange={(event) => sync.setCode(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") sync.signIn();
                    }}
                    className="settings-input settings-input-wide"
                  />

                  <button
                    type="button"
                    onClick={sync.signIn}
                    disabled={sync.busy || !sync.code.trim()}
                    className="settings-save"
                  >
                    {sync.busy ? "..." : "Se connecter"}
                  </button>
                </div>
              )}
            </div>

            {sync.step === "code" && (
              <>
                <div className="settings-actions">
                  <button
                    type="button"
                    onClick={sync.sendCode}
                    disabled={sync.busy || sync.cooldownSeconds > 0}
                    className="settings-secondary"
                  >
                    {sync.cooldownSeconds > 0
                      ? `Renvoyer (${sync.cooldownSeconds}s)`
                      : "Renvoyer le code"}
                  </button>

                  <button
                    type="button"
                    onClick={sync.changeEmail}
                    disabled={sync.busy}
                    className="settings-secondary"
                  >
                    Changer d'adresse
                  </button>
                </div>

                <p className="settings-help settings-help-compact">
                  {sync.devCode
                    ? `Code (dev) : ${sync.devCode}`
                    : "Colle le code à 6 chiffres reçu par e-mail, ou l'adresse du lien reçu par e-mail."}
                </p>
              </>
            )}
          </>
        )}

        {sync.message && (
          <div className="settings-status" role="status">
            {sync.message}
          </div>
        )}

        {sync.error && (
          <div role="alert" className="settings-alert">
            {sync.error}
          </div>
        )}
      </div>
    </section>
  );
}

export default function SyncAccountSection({ sync, username }) {
  if (!sync) {
    return <SyncAccountSectionFromHook />;
  }

  return <SyncAccountSectionView sync={sync} username={username} />;
}
