import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addPackComment,
  backfillPackInstalls,
  createPackVariantSource,
  fetchPackPreview,
  getPackFamily,
  getMyPackStatus,
  getPackPublishStatus,
  listPackSuggestedEditTargets,
  listPackActivity,
  listPackComments,
  listPackPublications,
  markPackActivityRead,
  publishPack,
  publishPackDraft,
  ratePack,
  recordPackInstall,
  requestPackPublishCode,
  signOutPackPublisher,
  submitPackSuggestedEdit,
  unpublishPack,
  verifyPackPublishCode
} from "../../../api/packs";
import { getStudySummary } from "../../../api/study";
import { listGroups } from "../../../api/groups";
import { listCollections } from "../../../api/collections";
import {
  POPULAR_THEME,
  useBrowsePacks
} from "../hooks/useBrowsePacks";
import BrowsePacks from "./BrowsePacks";

vi.mock("../hooks/useBrowsePacks", () => ({
  POPULAR_THEME: "__popular__",
  useBrowsePacks: vi.fn()
}));

vi.mock("../../../api/groups", () => ({
  listGroups: vi.fn()
}));

vi.mock("../../../api/collections", () => ({
  listCollections: vi.fn()
}));

vi.mock("../../../api/packs", () => ({
  addPackComment: vi.fn(),
  backfillPackInstalls: vi.fn(),
  createPackVariantSource: vi.fn(),
  fetchPackPreview: vi.fn(),
  getPackFamily: vi.fn(),
  getMyPackStatus: vi.fn(),
  getPackPublishStatus: vi.fn(),
  listPackSuggestedEditTargets: vi.fn(),
  listPackActivity: vi.fn(),
  listPackComments: vi.fn(),
  listPackPublications: vi.fn(),
  markPackActivityRead: vi.fn(),
  publishPack: vi.fn(),
  publishPackDraft: vi.fn(),
  ratePack: vi.fn(),
  recordPackInstall: vi.fn(),
  requestPackPublishCode: vi.fn(),
  savePlaylistDraft: vi.fn(),
  signOutPackPublisher: vi.fn(),
  submitPackSuggestedEdit: vi.fn(),
  unpublishPack: vi.fn(),
  verifyPackPublishCode: vi.fn()
}));

vi.mock("../../../api/study", () => ({
  getStudySummary: vi.fn()
}));

const mapEntry = {
  pack_guid: "world-map",
  name: "Territoires du monde",
  description: "Tous les pays du monde sur une carte interactive.",
  license: "CC0",
  version: 2,
  type_group: "map",
  question_count: 252,
  size_bytes: 72420,
  download_url: "https://example.com/world.zip"
};

const textEntry = {
  pack_guid: "biology-text",
  name: "Biologie cellulaire",
  description: "Questions isolées sur les organites et la mitose.",
  license: "CC-BY",
  version: 1,
  type_group: "text",
  question_count: 48,
  size_bytes: 18800,
  download_url: "https://example.com/bio.zip"
};

function item(
  entry,
  status = "not_installed",
  installedVersion = null,
  action = {},
  extra = {}
) {
  return { entry, status, installedVersion, action, ...extra };
}

function defaultHook(overrides = {}) {
  const value = {
    facets: {
      themes: [
        { value: POPULAR_THEME, label: "Populaires", result_count: 12 },
        { value: "géographie", label: "Géographie", result_count: 5 },
        { value: "biologie", label: "Biologie", result_count: 3 }
      ]
    },
    items: [
      item(mapEntry, "not_installed"),
      item(textEntry, "up_to_date", 1)
    ],
    loading: false,
    loadingMore: false,
    error: "",
    total: 12,
    hasMore: true,
    reload: vi.fn(),
    loadMore: vi.fn(),
    install: vi.fn(),
    update: vi.fn(),
    unsubscribe: vi.fn(),
    itemForEntry: (entry) => item(entry, "not_installed"),
    ...overrides
  };

  useBrowsePacks.mockReturnValue(value);
  return value;
}

describe("BrowsePacks", () => {
  beforeEach(() => {
    listGroups.mockResolvedValue([
      { id: 10, name: "Capitales du monde", type_group: "map", question_count: 42 },
      { id: 11, name: "Groupe vide", type_group: "text", question_count: 0 }
    ]);
    listCollections.mockResolvedValue([
      { id: 4, name: "Drapeaux mix", question_count: 12, generated: false },
      {
        id: 5,
        name: "Questions difficiles",
        question_count: 3,
        generated: true
      }
    ]);
    getPackPublishStatus.mockResolvedValue({
      configured: true,
      signed_in: true,
      account_email: "author@example.com",
      project_url: "https://project.supabase.co"
    });
    listPackPublications.mockResolvedValue({ publications: [] });
    publishPack.mockResolvedValue({
      status: "published",
      publication: {
        pack_guid: "group-guid",
        name: "Atlas des capitales",
        version: 1,
        question_count: 42,
        size_bytes: 2048,
        is_public: true
      }
    });
    publishPackDraft.mockResolvedValue({
      status: "published",
      publication: {
        pack_guid: "group-guid",
        name: "Atlas des capitales",
        version: 1,
        question_count: 42,
        size_bytes: 2048,
        is_public: true
      }
    });
    requestPackPublishCode.mockResolvedValue({});
    verifyPackPublishCode.mockResolvedValue({
      configured: true,
      signed_in: true,
      account_email: "author@example.com",
      project_url: "https://project.supabase.co"
    });
    signOutPackPublisher.mockResolvedValue({
      configured: true,
      signed_in: false,
      account_email: null,
      project_url: "https://project.supabase.co"
    });
    backfillPackInstalls.mockResolvedValue({ recorded: 0 });
    recordPackInstall.mockResolvedValue({ recorded: true });
    listPackActivity.mockResolvedValue({ events: [], unread_count: 0 });
    markPackActivityRead.mockResolvedValue({ updated: 0 });
    getPackFamily.mockResolvedValue({
      pack_guid: "world-map",
      original_pack_guid: "world-map",
      recommended_pack_guid: "world-map",
      variant_count: 0,
      packs: []
    });
    createPackVariantSource.mockResolvedValue({
      status: "created",
      source_kind: "group",
      source_id: 42,
      source_guid: "variant-source-guid",
      name: "Territoires du monde - variante",
      type_group: "map",
      question_count: 252,
      variant_of_pack_guid: "world-map",
      base_pack_name: "Territoires du monde"
    });
    listPackComments.mockResolvedValue({ comments: [] });
    listPackSuggestedEditTargets.mockResolvedValue({
      pack_guid: "biology-text",
      targets: [{
        question_guid: "mitochondrie-guid",
        group_guid: "bio-group",
        group_name: "Organites",
        type_q: "text",
        question: "Mitochondrie",
        answer: "Organite"
      }]
    });
    submitPackSuggestedEdit.mockResolvedValue({
      suggestion: {
        id: 4,
        pack_guid: "biology-text",
        status: "pending",
        target_label: "Mitochondrie",
        proposed_answer: "Organite producteur d'énergie",
        note: "Réponse plus précise."
      }
    });
    getMyPackStatus.mockResolvedValue({ is_installed: false, my_rating: null });
    ratePack.mockResolvedValue({ my_rating: 5, avg_rating: 5, rating_count: 1 });
    addPackComment.mockResolvedValue({
      comment: { id: 1, author_label: "me@example.com", body: "Top !" }
    });
    unpublishPack.mockResolvedValue({
      status: "unpublished",
      publication: { pack_guid: "group-guid", publication_status: "archived" }
    });
    getStudySummary.mockResolvedValue({
      scope: { type: "pack" },
      counts: { total_atomic_questions: 48, active_questions: 48, due_now: 0 },
      buckets: { unseen: 48, learning: 0, fragile: 0, stable: 0, mastered: 0 },
      recent_misses: { item_count: 0 },
      confusions: { event_count: 0 }
    });
    fetchPackPreview.mockResolvedValue({
      pack_guid: "biology-text",
      question_count: 48,
      item_types: [{ type_q: "text", count: 48 }],
      samples: [
        { type_q: "text", question: "Mitochondrie", answer: "Organite" }
      ],
      sample_count: 1,
      truncated: true
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("renders the dense importer with database themes", () => {
    defaultHook();
    render(<BrowsePacks setMode={vi.fn()} />);

    expect(screen.getByRole("tab", { name: "Découvrir" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    const themeButtons = within(
      screen.getByRole("complementary", { name: "Thèmes" })
    ).getAllByRole("button");
    expect(themeButtons[0]).toHaveTextContent("Populaires");
    expect(themeButtons[1]).toHaveTextContent("Géographie");
    expect(screen.getByRole("button", { name: /Géographie/ })).toBeInTheDocument();
    expect(screen.getByTestId("pack-card-row-world-map")).toBeInTheDocument();
    expect(screen.getAllByText("12").length).toBeGreaterThan(0);
  });

  it("switches themes and sends the theme to the search hook", async () => {
    defaultHook();
    render(<BrowsePacks setMode={vi.fn()} />);

    expect(useBrowsePacks).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: POPULAR_THEME })
    );

    await userEvent.click(
      within(screen.getByRole("complementary", { name: "Thèmes" }))
        .getByRole("button", { name: /Biologie/ })
    );

    expect(useBrowsePacks).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: "biologie" })
    );
  });

  it("debounces search and moves filters to the toolbar", async () => {
    vi.useFakeTimers();
    defaultHook();
    render(<BrowsePacks setMode={vi.fn()} />);

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Rechercher un pack" }),
      { target: { value: "atlas" } }
    );
    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "map" }
    });
    fireEvent.change(screen.getByLabelText("Statut"), {
      target: { value: "not_installed" }
    });
    fireEvent.change(screen.getByLabelText("Tri"), {
      target: { value: "questions" }
    });

    await act(async () => {
      vi.advanceTimersByTime(320);
    });

    expect(useBrowsePacks).toHaveBeenLastCalledWith(
      expect.objectContaining({
        search: "atlas",
        type: "map",
        status: "not_installed",
        sort: "questions"
      })
    );
  });

  it("selects a menu-targeted pack without using the search input", () => {
    const onInitialPackHandled = vi.fn();
    defaultHook();

    render(
      <BrowsePacks
        setMode={vi.fn()}
        initialPackGuid="biology-text"
        onInitialPackHandled={onInitialPackHandled}
      />
    );

    expect(screen.getByRole("searchbox", { name: "Rechercher un pack" }))
      .toHaveValue("");
    expect(screen.queryByText("Pack sélectionné")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Désélectionner" }))
      .not.toBeInTheDocument();
    expect(
      within(screen.getByRole("complementary", { name: "Détail du pack" }))
        .getByRole("heading", { name: "Biologie cellulaire" })
    ).toBeInTheDocument();
    expect(useBrowsePacks).toHaveBeenLastCalledWith(
      expect.objectContaining({
        search: "",
        sort: "populaires",
        theme: POPULAR_THEME
      })
    );
    expect(onInitialPackHandled).toHaveBeenCalledTimes(1);
  });

  it("loads the next catalogue page", async () => {
    const hook = defaultHook();
    render(<BrowsePacks setMode={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Charger plus" }));

    expect(hook.loadMore).toHaveBeenCalledTimes(1);
  });

  it("surfaces catalogue errors and retries loading", async () => {
    const hook = defaultHook({
      error: "Catalogue impossible à charger.",
      items: [],
      total: 0,
      hasMore: false
    });

    render(<BrowsePacks setMode={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Catalogue impossible à charger.");

    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));

    expect(hook.reload).toHaveBeenCalled();
  });

  it("calls install from a pack row action", async () => {
    const hook = defaultHook();
    render(<BrowsePacks setMode={vi.fn()} />);

    await userEvent.click(
      screen.getAllByLabelText("Installer Territoires du monde")[0]
    );

    expect(hook.install).toHaveBeenCalledWith(mapEntry);
  });

  it("shows grouped family badges on catalog cards", () => {
    defaultHook({
      items: [
        item({
          ...mapEntry,
          variant_of_pack_guid: "world-original",
          root_pack_guid: "world-original",
          original_pack_guid: "world-original",
          recommended_pack_guid: "world-map",
          original_name: "Pays du monde",
          variant_count: 4,
          is_recommended_variant: true
        }, "not_installed")
      ],
      total: 1,
      hasMore: false
    });

    render(<BrowsePacks setMode={vi.fn()} />);

    const card = screen.getByTestId("pack-card-row-world-map");
    expect(within(card).getByText("Variante")).toBeInTheDocument();
    expect(within(card).getByText("Recommandé")).toBeInTheDocument();
    expect(within(card).getByText("4 variantes")).toBeInTheDocument();
    expect(within(card).getByText("Variante recommandée de Pays du monde"))
      .toBeInTheDocument();
  });

  it("lets the detail panel select another pack from the family list", async () => {
    defaultHook({
      items: [
        item({
          ...mapEntry,
          variant_count: 1,
          root_pack_guid: "world-map",
          original_pack_guid: "world-map",
          recommended_pack_guid: "variant-map"
        }, "not_installed")
      ],
      total: 1,
      hasMore: false
    });
    getPackFamily.mockResolvedValue({
      pack_guid: "world-map",
      original_pack_guid: "world-map",
      recommended_pack_guid: "variant-map",
      variant_count: 1,
      packs: [
        {
          ...mapEntry,
          root_pack_guid: "world-map",
          original_pack_guid: "world-map",
          recommended_pack_guid: "variant-map",
          variant_count: 1
        },
        {
          ...mapEntry,
          pack_guid: "variant-map",
          name: "Territoires du monde corrigé",
          variant_of_pack_guid: "world-map",
          root_pack_guid: "world-map",
          original_pack_guid: "world-map",
          recommended_pack_guid: "variant-map",
          original_name: "Territoires du monde",
          variant_count: 1,
          is_recommended_variant: true
        }
      ]
    });

    render(<BrowsePacks setMode={vi.fn()} />);

    await userEvent.click(
      await screen.findByRole("button", { name: /Territoires du monde corrigé/ })
    );

    expect(
      within(screen.getByRole("complementary", { name: "Détail du pack" }))
        .getByRole("heading", { name: "Territoires du monde corrigé" })
    ).toBeInTheDocument();
  });

  it("creates a variant source and opens the publish form in variant mode", async () => {
    defaultHook({
      items: [item(mapEntry, "up_to_date", 2)],
      total: 1,
      hasMore: false
    });

    render(<BrowsePacks setMode={vi.fn()} />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Créer une variante" })
    );

    await waitFor(() => {
      expect(createPackVariantSource).toHaveBeenCalledWith("world-map");
    });
    expect(
      await screen.findByRole("heading", { name: "Publier une variante" })
    ).toBeInTheDocument();
    expect(screen.getByText("Variante de")).toBeInTheDocument();
  });

  it("submits a suggested edit for an installed pack", async () => {
    defaultHook();

    render(<BrowsePacks setMode={vi.fn()} />);

    await userEvent.click(
      screen.getByRole("button", { name: /Biologie cellulaire/ })
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Suggérer une correction" })
    );

    await waitFor(() => {
      expect(listPackSuggestedEditTargets).toHaveBeenCalledWith("biology-text");
    });
    await screen.findByRole("option", { name: /Mitochondrie/ });
    await userEvent.selectOptions(
      screen.getByLabelText("Question concernée"),
      "mitochondrie-guid"
    );
    await userEvent.type(
      screen.getByLabelText("Réponse proposée"),
      "Organite producteur d'énergie"
    );
    await userEvent.type(
      screen.getByLabelText("Note"),
      "Réponse plus précise."
    );
    await userEvent.click(screen.getByRole("button", { name: "Envoyer" }));

    await waitFor(() => {
      expect(submitPackSuggestedEdit).toHaveBeenCalledWith("biology-text", {
        target_question_guid: "mitochondrie-guid",
        proposed_question: "",
        proposed_answer: "Organite producteur d'énergie",
        note: "Réponse plus précise."
      });
    });
    expect(await screen.findByText("Suggestion envoyée.")).toBeInTheDocument();
  });

  it("shows unread pack activity and marks it read", async () => {
    listPackActivity.mockResolvedValue({
      unread_count: 1,
      events: [{
        id: 42,
        event_type: "variant_published",
        pack_guid: "world-map",
        pack_name: "Territoires du monde",
        related_pack_guid: "variant-map",
        related_pack_name: "Territoires corrigés",
        read_at: null
      }]
    });
    defaultHook();

    render(<BrowsePacks setMode={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Activité/ }))
        .toHaveTextContent("1");
    });
    await userEvent.click(screen.getByRole("button", { name: /Activité/ }));

    expect(screen.getByRole("dialog", { name: "Activité des packs" }))
      .toHaveTextContent("Territoires corrigés");
    await userEvent.click(
      screen.getByRole("button", { name: "Tout marquer comme lu" })
    );

    await waitFor(() => {
      expect(markPackActivityRead).toHaveBeenCalledWith([42]);
    });
  });

  it("shows the suggested-edit actor label in pack activity", async () => {
    listPackActivity.mockResolvedValue({
      unread_count: 1,
      events: [{
        id: 43,
        event_type: "suggested_edit_created",
        pack_guid: "world-map",
        pack_name: "Territoires du monde",
        related_pack_guid: "world-map",
        related_pack_name: "Territoires du monde",
        payload: {
          author_label: "Lectrice",
          target_label: "Capitale de la France ?"
        },
        read_at: null
      }]
    });
    defaultHook();

    render(<BrowsePacks setMode={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: /Activité/ }));
    const dialog = screen.getByRole("dialog", { name: "Activité des packs" });

    expect(dialog).toHaveTextContent("Capitale de la France ?");
    expect(dialog).toHaveTextContent(
      "Lectrice propose une correction pour Territoires du monde"
    );
  });

  it("shows mine and local-copy checks without install actions", () => {
    const onOpenGroup = vi.fn();
    const localEntry = {
      ...mapEntry,
      pack_guid: "my-pack",
      name: "Mon atlas publié"
    };
    defaultHook({
      items: [
        item(localEntry, "local_copy", null, {}, {
          hasLocalContent: true,
          isMine: true,
          localGroupId: 10
        })
      ],
      total: 1,
      hasMore: false
    });

    render(<BrowsePacks setMode={vi.fn()} onOpenGroup={onOpenGroup} />);

    expect(screen.getAllByText("Mon pack").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Déjà présent").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Ce pack existe déjà dans tes groupes locaux.")
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Installer Mon atlas publié")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Se désabonner" })
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Ouvrir Mon atlas publié dans le gestionnaire"
      })
    );

    expect(onOpenGroup).toHaveBeenCalledWith(10);
  });

  it("opens Study from an installed pack detail", () => {
    const onOpenStudy = vi.fn();

    defaultHook({
      items: [
        item(textEntry, "up_to_date", 1, {}, {
          localGroupId: 12
        })
      ],
      total: 1,
      hasMore: false
    });

    render(
      <BrowsePacks
        setMode={vi.fn()}
        onOpenGroup={vi.fn()}
        onOpenStudy={onOpenStudy}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Étudier ce pack" }));

    expect(onOpenStudy).toHaveBeenCalledWith({
      type: "pack",
      packGuid: "biology-text",
      name: "Biologie cellulaire"
    });
  });

  it("deletes an installed pack's content after confirmation", () => {
    const unsubscribe = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    defaultHook({
      items: [item(textEntry, "up_to_date", 1)],
      total: 1,
      hasMore: false,
      unsubscribe
    });

    render(<BrowsePacks setMode={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledWith("biology-text", {
      deleteContent: true
    });

    window.confirm.mockRestore();
  });

  it("does not delete an installed pack when the confirmation is declined", () => {
    const unsubscribe = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(false);

    defaultHook({
      items: [item(textEntry, "up_to_date", 1)],
      total: 1,
      hasMore: false,
      unsubscribe
    });

    render(<BrowsePacks setMode={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(unsubscribe).not.toHaveBeenCalled();

    window.confirm.mockRestore();
  });

  it("shows tags, themes, and an estimated time for the selected pack", () => {
    defaultHook({
      items: [
        item(
          { ...mapEntry, tags: ["europe"], themes: ["Géographie"], estimated_minutes: 63 },
          "not_installed"
        )
      ],
      total: 1,
      hasMore: false
    });

    render(<BrowsePacks setMode={vi.fn()} />);

    const detail = within(
      screen.getByRole("complementary", { name: "Détail du pack" })
    );

    expect(detail.getByText("Géographie")).toBeInTheDocument();
    expect(detail.getByText("europe")).toBeInTheDocument();
    expect(detail.getByText("~1 h 03")).toBeInTheDocument();
  });

  it("loads and reveals a preview for the selected pack", async () => {
    defaultHook({
      items: [item(mapEntry, "not_installed")],
      total: 1,
      hasMore: false
    });
    fetchPackPreview.mockResolvedValue({
      pack_guid: "world-map",
      question_count: 252,
      item_types: [{ type_q: "map", count: 252 }],
      samples: [{ type_q: "map", question: "France", answer: "Paris" }],
      sample_count: 1,
      truncated: true
    });

    render(<BrowsePacks setMode={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Voir un aperçu" }));

    expect(fetchPackPreview).toHaveBeenCalledWith(
      "world-map",
      mapEntry.download_url
    );
    expect(await screen.findByText("France")).toBeInTheDocument();
    expect(screen.queryByText("Paris")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Révéler la réponse" }));

    expect(screen.getByText("Paris")).toBeInTheDocument();
  });

  it("shows the installed pack's mastery progress and recommended action", async () => {
    getStudySummary.mockResolvedValue({
      scope: { type: "pack" },
      counts: { total_atomic_questions: 48, active_questions: 48, due_now: 5 },
      buckets: { unseen: 0, learning: 2, fragile: 1, stable: 10, mastered: 35 },
      recent_misses: { item_count: 0 },
      confusions: { event_count: 0 }
    });
    defaultHook({
      items: [item(textEntry, "up_to_date", 1)],
      total: 1,
      hasMore: false
    });

    render(<BrowsePacks setMode={vi.fn()} onOpenStudy={vi.fn()} />);

    expect(getStudySummary).toHaveBeenCalledWith({
      type: "pack",
      packGuid: "biology-text"
    });
    expect(await screen.findByText("Maîtrisé")).toBeInTheDocument();
    expect(screen.getByText("Faire la review due")).toBeInTheDocument();
  });

  it("does not fetch a progress summary for a not-installed pack", () => {
    defaultHook({
      items: [item(mapEntry, "not_installed")],
      total: 1,
      hasMore: false
    });

    render(<BrowsePacks setMode={vi.fn()} />);

    expect(getStudySummary).not.toHaveBeenCalled();
  });

  it("publishes a group in a single click, with no draft step", async () => {
    defaultHook();
    render(<BrowsePacks setMode={vi.fn()} />);

    await userEvent.click(screen.getByRole("tab", { name: "Publier" }));

    // Step 1: pick a source. Step 2 (the form) only appears after that.
    await userEvent.click(
      await screen.findByRole("button", { name: /Capitales du monde/ })
    );

    const publishButton = await screen.findByRole("button", {
      name: "Publier"
    });

    await waitFor(() => expect(publishButton).toBeEnabled());
    await userEvent.clear(screen.getByRole("textbox", { name: "Titre du pack" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Titre du pack" }),
      "États et géographie"
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "Mots-clés de recherche du pack" }),
      "capitales, quiz"
    );
    await userEvent.click(publishButton);

    await waitFor(() => {
      expect(publishPack).toHaveBeenCalledWith(
        { groupId: 10 },
        {
          name: "États et géographie",
          description: "",
          license: "",
          tags: ["capitales", "quiz"]
        }
      );
    });

    // The pack goes straight to public: no "Brouillon" state is ever shown.
    // Confirmation is landing on the fresh pack's own dashboard, not a banner.
    expect(screen.queryByText("Brouillon privé")).not.toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Atlas des capitales" })
    ).toBeInTheDocument();
    expect(screen.getAllByText("Publié").length).toBeGreaterThan(0);
  });

  it("publishes a playlist as a multi-group pack", async () => {
    defaultHook();
    render(<BrowsePacks setMode={vi.fn()} />);

    await userEvent.click(screen.getByRole("tab", { name: "Publier" }));
    await userEvent.click(await screen.findByRole("tab", { name: "Playlist" }));

    await userEvent.click(
      await screen.findByRole("button", { name: /Drapeaux mix/ })
    );
    await userEvent.click(screen.getByRole("button", { name: "Publier" }));

    await waitFor(() => {
      expect(publishPack).toHaveBeenCalledWith(
        { collectionId: 4 },
        expect.objectContaining({ name: "Drapeaux mix" })
      );
    });
  });

  it("refuses to publish a generated playlist", async () => {
    defaultHook();
    render(<BrowsePacks setMode={vi.fn()} />);

    await userEvent.click(screen.getByRole("tab", { name: "Publier" }));
    await userEvent.click(await screen.findByRole("tab", { name: "Playlist" }));

    // "Questions difficiles" is derived from the user's own review history,
    // so it is not theirs to hand to someone else.
    expect(
      await screen.findByRole("button", { name: /Questions difficiles/ })
    ).toBeDisabled();
  });

  it("does not offer a local ZIP download", async () => {
    defaultHook();
    render(<BrowsePacks setMode={vi.fn()} />);

    await userEvent.click(screen.getByRole("tab", { name: "Publier" }));
    await userEvent.click(
      await screen.findByRole("button", { name: /Capitales du monde/ })
    );
    await screen.findByRole("button", { name: "Publier" });

    // The zip had no way back in -- nothing in the app could import a
    // manually obtained file -- so the button is gone.
    expect(
      screen.queryByRole("button", { name: "Télécharger ZIP" })
    ).not.toBeInTheDocument();
  });

  it("reuses the Settings sync account for publishing without showing an auth panel", async () => {
    const setMode = vi.fn();
    getPackPublishStatus.mockResolvedValue({
      configured: true,
      signed_in: true,
      account_email: "sync@example.com",
      auth_source: "sync",
      project_url: "https://project.supabase.co"
    });
    defaultHook();

    render(<BrowsePacks setMode={setMode} />);

    await userEvent.click(screen.getByRole("tab", { name: "Publier" }));

    // Already signed in via the Settings sync account -- there is nothing to
    // do here, so no "Connecté via Synchronisation" status panel is shown.
    await userEvent.click(
      await screen.findByRole("button", { name: /Capitales du monde/ })
    );
    await screen.findByRole("button", { name: "Publier" });

    expect(screen.queryByText("Connecté via Synchronisation")).not.toBeInTheDocument();
    expect(screen.queryByText("Connexion Supabase")).not.toBeInTheDocument();
  });

  it("switches to the Gérer tab and renders the publications manager", async () => {
    defaultHook();
    listPackPublications.mockResolvedValue({
      publications: [
        {
          pack_guid: "group-guid",
          name: "Atlas des capitales",
          version: 1,
          question_count: 42,
          is_public: true,
          publication_status: "published"
        }
      ]
    });

    render(<BrowsePacks setMode={vi.fn()} />);

    await userEvent.click(screen.getByRole("tab", { name: "Publier" }));

    expect(screen.getByRole("tab", { name: "Publier" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    // The manager opens on "Nouveau pack" rather than auto-selecting a
    // publication, so the proof it mounted with its data is the pack's row in
    // the rail, not a detail heading.
    const rail = await screen.findByRole("region", { name: "Mes packs" });

    expect(
      await within(rail).findByRole("button", { name: /Atlas des capitales/ })
    ).toBeInTheDocument();
  });

  it("forwards the top-rated sort option to the search hook", async () => {
    defaultHook();
    render(<BrowsePacks setMode={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Tri"), {
      target: { value: "note" }
    });

    expect(useBrowsePacks).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: "note" })
    );
    expect(
      within(screen.getByLabelText("Tri")).getByRole("option", {
        name: "Mieux notés"
      })
    ).toBeInTheDocument();
  });
});
