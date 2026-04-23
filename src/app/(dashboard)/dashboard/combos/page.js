"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, Button, Modal, Input, CardSkeleton, ModelSelectModal, Toggle } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";

const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;
const CATEGORY_OPTIONS = ["coding", "writing", "analysis", "translation", "general"];
const CATEGORY_LABELS = {
  coding: "Coding",
  writing: "Writing",
  analysis: "Analysis",
  translation: "Translation",
  general: "General",
};

function normalizeCategory(value) {
  if (!value || typeof value !== "string") return "general";
  const normalized = value.trim().toLowerCase();
  return CATEGORY_OPTIONS.includes(normalized) ? normalized : "general";
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map(tag => String(tag).trim().toLowerCase()).filter(Boolean))].slice(0, 10);
}

function filterCombos(combos, selectedCategory, query) {
  return combos.filter((combo) => {
    const category = normalizeCategory(combo.category);
    if (selectedCategory !== "all" && category !== selectedCategory) return false;

    if (!query) return true;
    const q = query.toLowerCase();
    const tags = normalizeTags(combo.tags);
    const description = typeof combo.description === "string" ? combo.description.toLowerCase() : "";
    return combo.name.toLowerCase().includes(q) || tags.some(tag => tag.includes(q)) || description.includes(q);
  });
}

function groupByCategory(combos) {
  return combos.reduce((acc, combo) => {
    const category = normalizeCategory(combo.category);
    if (!acc[category]) acc[category] = [];
    acc[category].push(combo);
    return acc;
  }, {});
}

function categoryClass(category) {
  switch (category) {
    case "coding":
      return "bg-blue-500/10 text-blue-600 dark:text-blue-300";
    case "writing":
      return "bg-purple-500/10 text-purple-600 dark:text-purple-300";
    case "analysis":
      return "bg-amber-500/10 text-amber-600 dark:text-amber-300";
    case "translation":
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300";
    default:
      return "bg-black/5 dark:bg-white/10 text-text-muted";
  }
}

export default function CombosPage() {
  const [combos, setCombos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCombo, setEditingCombo] = useState(null);
  const [activeProviders, setActiveProviders] = useState([]);
  const [comboStrategies, setComboStrategies] = useState({});
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchText, setSearchText] = useState("");
  const [showSuggestModal, setShowSuggestModal] = useState(false);
  const [regrouping, setRegrouping] = useState(false);
  const { copied, copy } = useCopyToClipboard();

  useEffect(() => {
    fetchData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchData = async () => {
    try {
      const [combosRes, providersRes, settingsRes] = await Promise.all([
        fetch("/api/combos"),
        fetch("/api/providers"),
        fetch("/api/settings"),
      ]);
      const combosData = await combosRes.json();
      const providersData = await providersRes.json();
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};

      if (combosRes.ok) setCombos(combosData.combos || []);
      if (providersRes.ok) setActiveProviders(providersData.connections || []);
      setComboStrategies(settingsData.comboStrategies || {});
    } catch (error) {
      console.log("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (data) => {
    try {
      const res = await fetch("/api/combos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchData();
        setShowCreateModal(false);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to create combo");
      }
    } catch (error) {
      console.log("Error creating combo:", error);
    }
  };

  const handleUpdate = async (id, data) => {
    try {
      const res = await fetch(`/api/combos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchData();
        setEditingCombo(null);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to update combo");
      }
    } catch (error) {
      console.log("Error updating combo:", error);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this combo?")) return;
    try {
      const res = await fetch(`/api/combos/${id}`, { method: "DELETE" });
      if (res.ok) setCombos(combos.filter(c => c.id !== id));
    } catch (error) {
      console.log("Error deleting combo:", error);
    }
  };

  const handleToggleRoundRobin = async (comboName, enabled) => {
    try {
      const updated = { ...comboStrategies };
      if (enabled) updated[comboName] = { fallbackStrategy: "round-robin" };
      else delete updated[comboName];

      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comboStrategies: updated }),
      });

      setComboStrategies(updated);
    } catch (error) {
      console.log("Error updating combo strategy:", error);
    }
  };

  const handleRegroup = async () => {
    if (!confirm("Regroup all combos with auto-scoring?")) return;
    setRegrouping(true);
    try {
      const res = await fetch("/api/combos/regroup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false }),
      });
      if (res.ok) {
        await fetchData();
        const result = await res.json();
        alert(`Regrouped ${result.updated} combos, skipped ${result.skipped}`);
      } else {
        alert("Failed to regroup combos");
      }
    } catch (error) {
      console.log("Error regrouping:", error);
    } finally {
      setRegrouping(false);
    }
  };

  const filtered = useMemo(
    () => filterCombos(combos, selectedCategory, searchText.trim()),
    [combos, selectedCategory, searchText]
  );
  const grouped = useMemo(() => groupByCategory(filtered), [filtered]);
  const groupKeys = useMemo(
    () => Object.keys(grouped).sort((a, b) => CATEGORY_OPTIONS.indexOf(a) - CATEGORY_OPTIONS.indexOf(b)),
    [grouped]
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Combos</h1>
          <p className="text-sm text-text-muted mt-1">Create model combos with fallback support</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" icon="auto_awesome" onClick={() => setShowSuggestModal(true)}>Suggest Combos</Button>
          <Button variant="ghost" icon="sync" onClick={handleRegroup} disabled={regrouping}>{regrouping ? "Regrouping..." : "Regroup"}</Button>
          <Button icon="add" onClick={() => setShowCreateModal(true)}>Create Combo</Button>
        </div>
      </div>

      {combos.length > 0 && (
        <Card padding="sm">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {["all", ...CATEGORY_OPTIONS].map((category) => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    selectedCategory === category
                      ? "bg-primary text-white"
                      : "bg-black/5 dark:bg-white/10 text-text-muted hover:text-text-main"
                  }`}
                >
                  {category === "all" ? "All" : CATEGORY_LABELS[category]}
                </button>
              ))}
            </div>
            <Input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search by name, tags, or description"
            />
          </div>
        </Card>
      )}

      {combos.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
              <span className="material-symbols-outlined text-[32px]">layers</span>
            </div>
            <p className="text-text-main font-medium mb-1">No combos yet</p>
            <p className="text-sm text-text-muted mb-4">Create model combos with fallback support</p>
            <Button icon="add" onClick={() => setShowCreateModal(true)}>Create Combo</Button>
          </div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <div className="text-center py-10 text-sm text-text-muted">No combos match current filters.</div>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {groupKeys.map((category) => (
            <div key={category} className="flex flex-col gap-2">
              <div className="text-xs uppercase tracking-wide text-text-muted font-semibold">
                {CATEGORY_LABELS[category] || "General"} ({grouped[category].length})
              </div>
              <div className="flex flex-col gap-3">
                {grouped[category].map((combo) => (
                  <ComboCard
                    key={combo.id}
                    combo={combo}
                    copied={copied}
                    onCopy={copy}
                    onEdit={() => setEditingCombo(combo)}
                    onDelete={() => handleDelete(combo.id)}
                    roundRobinEnabled={comboStrategies[combo.name]?.fallbackStrategy === "round-robin"}
                    onToggleRoundRobin={(enabled) => handleToggleRoundRobin(combo.name, enabled)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <ComboFormModal
        key="create"
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSave={handleCreate}
        activeProviders={activeProviders}
      />

      <ComboFormModal
        key={editingCombo?.id || "new"}
        isOpen={!!editingCombo}
        combo={editingCombo}
        onClose={() => setEditingCombo(null)}
        onSave={(data) => handleUpdate(editingCombo.id, data)}
        activeProviders={activeProviders}
      />

      <SuggestModal
        isOpen={showSuggestModal}
        onClose={() => setShowSuggestModal(false)}
        activeProviders={activeProviders}
        onApply={async () => {
          await fetchData();
          setShowSuggestModal(false);
        }}
      />
    </div>
  );
}

const PROFILE_COLORS = {
  fast: "bg-sky-500/10 text-sky-600 dark:text-sky-300",
  cheap: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  balanced: "bg-violet-500/10 text-violet-600 dark:text-violet-300",
  reliable: "bg-orange-500/10 text-orange-600 dark:text-orange-300",
};

function ComboCard({ combo, copied, onCopy, onEdit, onDelete, roundRobinEnabled, onToggleRoundRobin }) {
  const category = normalizeCategory(combo.category);
  const tags = normalizeTags(combo.tags);
  const description = typeof combo.description === "string" ? combo.description : "";
  const autoGroupMeta = combo.autoGroupMeta || null;

  return (
    <Card padding="sm" className="group">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-primary text-[18px]">layers</span>
          </div>
          <div className="min-w-0 flex-1">
            <code className="text-sm font-medium font-mono truncate">{combo.name}</code>
            <div className="flex items-center gap-1 mt-1 flex-wrap">
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${categoryClass(category)}`}>
                {CATEGORY_LABELS[category] || "General"}
              </span>
              {tags.map((tag) => (
                <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-text-muted">
                  {tag}
                </span>
              ))}
              {autoGroupMeta?.profile && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${PROFILE_COLORS[autoGroupMeta.profile] || "bg-black/5 dark:bg-white/10 text-text-muted"}`}>
                  {autoGroupMeta.profile} · {autoGroupMeta.score}
                </span>
              )}
            </div>
            {description && (
              <p className="text-[11px] text-text-muted mt-1 truncate">{description}</p>
            )}
            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
              {combo.models.length === 0 ? (
                <span className="text-xs text-text-muted italic">No models</span>
              ) : (
                combo.models.slice(0, 3).map((model, index) => (
                  <code key={index} className="text-[10px] font-mono bg-black/5 dark:bg-white/5 px-1.5 py-0.5 rounded text-text-muted">
                    {model}
                  </code>
                ))
              )}
              {combo.models.length > 3 && (
                <span className="text-[10px] text-text-muted">+{combo.models.length - 3} more</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-text-muted font-medium">Round Robin</span>
            <Toggle size="sm" checked={roundRobinEnabled} onChange={onToggleRoundRobin} />
          </div>

          <div className="flex gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); onCopy(combo.name, `combo-${combo.id}`); }}
              className="flex flex-col items-center px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-muted hover:text-primary transition-colors"
              title="Copy combo name"
            >
              <span className="material-symbols-outlined text-[18px]">{copied === `combo-${combo.id}` ? "check" : "content_copy"}</span>
              <span className="text-[10px] leading-tight">Copy</span>
            </button>
            <button
              onClick={onEdit}
              className="flex flex-col items-center px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-muted hover:text-primary transition-colors"
              title="Edit"
            >
              <span className="material-symbols-outlined text-[18px]">edit</span>
              <span className="text-[10px] leading-tight">Edit</span>
            </button>
            <button
              onClick={onDelete}
              className="flex flex-col items-center px-2 py-1 rounded hover:bg-red-500/10 text-red-500 transition-colors"
              title="Delete"
            >
              <span className="material-symbols-outlined text-[18px]">delete</span>
              <span className="text-[10px] leading-tight">Delete</span>
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function ModelItem({ index, model, isFirst, isLast, onEdit, onMoveUp, onMoveDown, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(model);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== model) onEdit(trimmed);
    else setDraft(model);
    setEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") {
      setDraft(model);
      setEditing(false);
    }
  };

  return (
    <div className="group flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/[0.02] dark:bg-white/[0.02] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors">
      <span className="text-[10px] font-medium text-text-muted w-3 text-center shrink-0">{index + 1}</span>

      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          className="flex-1 min-w-0 px-1.5 py-0.5 text-xs font-mono bg-white dark:bg-black/20 border border-primary/40 rounded outline-none text-text-main"
        />
      ) : (
        <div
          className="flex-1 min-w-0 px-1.5 py-0.5 text-xs font-mono text-text-main truncate cursor-text hover:bg-black/5 dark:hover:bg-white/5 rounded"
          onClick={() => setEditing(true)}
          title="Click to edit"
        >
          {model}
        </div>
      )}

      <div className="flex items-center gap-0.5">
        <button
          onClick={onMoveUp}
          disabled={isFirst}
          className={`p-0.5 rounded ${isFirst ? "text-text-muted/20 cursor-not-allowed" : "text-text-muted hover:text-primary hover:bg-black/5 dark:hover:bg-white/5"}`}
          title="Move up"
        >
          <span className="material-symbols-outlined text-[12px]">arrow_upward</span>
        </button>
        <button
          onClick={onMoveDown}
          disabled={isLast}
          className={`p-0.5 rounded ${isLast ? "text-text-muted/20 cursor-not-allowed" : "text-text-muted hover:text-primary hover:bg-black/5 dark:hover:bg-white/5"}`}
          title="Move down"
        >
          <span className="material-symbols-outlined text-[12px]">arrow_downward</span>
        </button>
      </div>

      <button
        onClick={onRemove}
        className="p-0.5 hover:bg-red-500/10 rounded text-text-muted hover:text-red-500 transition-all"
        title="Remove"
      >
        <span className="material-symbols-outlined text-[12px]">close</span>
      </button>
    </div>
  );
}

function SuggestModal({ isOpen, onClose, activeProviders, onApply }) {
  const [modelAliases, setModelAliases] = useState({});
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [candidateModels, setCandidateModels] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/models/alias")
      .then((res) => (res.ok ? res.json() : { aliases: {} }))
      .then((data) => setModelAliases(data.aliases || {}))
      .catch(() => setModelAliases({}));
  }, [isOpen]);

  const handleGenerate = async () => {
    if (candidateModels.length === 0) {
      alert("Please add candidate models first");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/combos/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateModels, maxModelsPerSuggestion: 4 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate suggestions");
      setSuggestions(data.profiles || []);
    } catch (error) {
      alert(error.message || "Failed to generate suggestions");
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async (profile) => {
    const name = prompt(`Combo name for ${profile.profile}:`, `combo-${profile.profile}-${Date.now()}`);
    if (!name) return;

    const res = await fetch("/api/combos/apply-suggestion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, profile: profile.profile, models: profile.models }),
    });

    if (!res.ok) {
      const err = await res.json();
      alert(err.error || "Failed to apply suggestion");
      return;
    }

    await onApply();
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Suggest Combos">
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Candidate Models</label>
            {candidateModels.length === 0 ? (
              <div className="text-xs text-text-muted border border-dashed border-black/10 dark:border-white/10 rounded-lg px-3 py-3">No candidate models yet</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {candidateModels.map((model) => (
                  <code key={model} className="text-[10px] font-mono bg-black/5 dark:bg-white/5 px-1.5 py-0.5 rounded text-text-muted">{model}</code>
                ))}
              </div>
            )}
            <div className="flex gap-2 mt-2">
              <Button size="sm" variant="ghost" onClick={() => setShowModelSelect(true)}>Add Candidate</Button>
              <Button size="sm" onClick={handleGenerate} disabled={loading}>{loading ? "Generating..." : "Generate Suggestions"}</Button>
            </div>
          </div>

          {suggestions.length > 0 && (
            <div className="grid grid-cols-1 gap-2 max-h-[360px] overflow-y-auto">
              {suggestions.map((profile) => (
                <div key={profile.profile} className="border border-black/10 dark:border-white/10 rounded-lg p-2.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium capitalize">{profile.profile}</div>
                      <div className="text-xs text-text-muted">Score: {profile.score}</div>
                    </div>
                    <Button size="sm" onClick={() => handleApply(profile)}>Apply</Button>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {(profile.models || []).map((m) => (
                      <code key={m} className="text-[10px] font-mono bg-black/5 dark:bg-white/5 px-1.5 py-0.5 rounded text-text-muted">{m}</code>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      <ModelSelectModal
        isOpen={showModelSelect}
        onClose={() => setShowModelSelect(false)}
        onSelect={(model) => {
          if (!candidateModels.includes(model.value)) {
            setCandidateModels([...candidateModels, model.value]);
          }
        }}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Add Candidate Model"
      />
    </>
  );
}

function ComboFormModal({ isOpen, combo, onClose, onSave, activeProviders }) {
  const [name, setName] = useState(combo?.name || "");
  const [models, setModels] = useState(combo?.models || []);
  const [category, setCategory] = useState(normalizeCategory(combo?.category));
  const [description, setDescription] = useState(typeof combo?.description === "string" ? combo.description : "");
  const [tags, setTags] = useState(normalizeTags(combo?.tags));
  const [tagInput, setTagInput] = useState("");
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [modelAliases, setModelAliases] = useState({});

  const fetchModalData = async () => {
    try {
      const aliasesRes = await fetch("/api/models/alias");
      if (!aliasesRes.ok) return;
      const aliasesData = await aliasesRes.json();
      setModelAliases(aliasesData.aliases || {});
    } catch (error) {
      console.error("Error fetching modal data:", error);
    }
  };

  useEffect(() => {
    if (isOpen) fetchModalData();
  }, [isOpen]);

  const validateName = (value) => {
    if (!value.trim()) {
      setNameError("Name is required");
      return false;
    }
    if (!VALID_NAME_REGEX.test(value)) {
      setNameError("Only letters, numbers, -, _ and . allowed");
      return false;
    }
    setNameError("");
    return true;
  };

  const handleNameChange = (e) => {
    const value = e.target.value;
    setName(value);
    if (value) validateName(value);
    else setNameError("");
  };

  const handleAddModel = (model) => {
    if (!models.includes(model.value)) setModels([...models, model.value]);
  };

  const handleRemoveModel = (index) => {
    setModels(models.filter((_, i) => i !== index));
  };

  const handleMoveUp = (index) => {
    if (index === 0) return;
    const newModels = [...models];
    [newModels[index - 1], newModels[index]] = [newModels[index], newModels[index - 1]];
    setModels(newModels);
  };

  const handleMoveDown = (index) => {
    if (index === models.length - 1) return;
    const newModels = [...models];
    [newModels[index], newModels[index + 1]] = [newModels[index + 1], newModels[index]];
    setModels(newModels);
  };

  const commitTags = (value) => {
    const incoming = value
      .split(",")
      .map(tag => tag.trim().toLowerCase())
      .filter(Boolean);
    if (incoming.length === 0) return;
    setTags((prev) => normalizeTags([...prev, ...incoming]));
    setTagInput("");
  };

  const handleTagKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitTags(tagInput);
    } else if (e.key === "Backspace" && !tagInput && tags.length > 0) {
      setTags(tags.slice(0, -1));
    }
  };

  const handleSave = async () => {
    if (!validateName(name)) return;
    commitTags(tagInput);
    setSaving(true);
    await onSave({
      name: name.trim(),
      models,
      category,
      tags: normalizeTags([...tags, ...tagInput.split(",")]),
      description: description.trim(),
    });
    setSaving(false);
  };

  const isEdit = !!combo;

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={isEdit ? "Edit Combo" : "Create Combo"}>
        <div className="flex flex-col gap-3">
          <div>
            <Input
              label="Combo Name"
              value={name}
              onChange={handleNameChange}
              placeholder="my-combo"
              error={nameError}
            />
            <p className="text-[10px] text-text-muted mt-0.5">Only letters, numbers, -, _ and . allowed</p>
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-black/10 dark:border-white/10 bg-transparent text-sm"
            >
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {CATEGORY_LABELS[option]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">Tags</label>
            <div className="border border-black/10 dark:border-white/10 rounded-md px-2 py-2 flex flex-wrap gap-1.5 min-h-10">
              {tags.map(tag => (
                <span key={tag} className="text-[11px] px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-text-muted inline-flex items-center gap-1">
                  {tag}
                  <button
                    type="button"
                    className="text-[10px] hover:text-red-500"
                    onClick={() => setTags(tags.filter(t => t !== tag))}
                  >
                    ×
                  </button>
                </span>
              ))}
              {tags.length < 10 && (
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  onBlur={() => commitTags(tagInput)}
                  className="flex-1 min-w-[120px] bg-transparent text-sm outline-none"
                  placeholder="Add tags..."
                />
              )}
            </div>
            <p className="text-[10px] text-text-muted mt-0.5">{tags.length}/10 tags</p>
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 200))}
              className="w-full px-3 py-2 rounded-md border border-black/10 dark:border-white/10 bg-transparent text-sm min-h-[72px]"
              placeholder="Short description for this combo"
            />
            <p className="text-[10px] text-text-muted mt-0.5">{description.length}/200</p>
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Models</label>

            {models.length === 0 ? (
              <div className="text-center py-4 border border-dashed border-black/10 dark:border-white/10 rounded-lg bg-black/[0.01] dark:bg-white/[0.01]">
                <span className="material-symbols-outlined text-text-muted text-xl mb-1">layers</span>
                <p className="text-xs text-text-muted">No models added yet</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1 max-h-[350px] overflow-y-auto">
                {models.map((model, index) => (
                  <ModelItem
                    key={index}
                    index={index}
                    model={model}
                    isFirst={index === 0}
                    isLast={index === models.length - 1}
                    onEdit={(newVal) => {
                      const updated = [...models];
                      updated[index] = newVal;
                      setModels(updated);
                    }}
                    onMoveUp={() => handleMoveUp(index)}
                    onMoveDown={() => handleMoveDown(index)}
                    onRemove={() => handleRemoveModel(index)}
                  />
                ))}
              </div>
            )}

            <button
              onClick={() => setShowModelSelect(true)}
              className="w-full mt-2 py-2 border border-dashed border-black/10 dark:border-white/10 rounded-lg text-xs text-primary font-medium hover:text-primary hover:border-primary/50 transition-colors flex items-center justify-center gap-1"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              Add Model
            </button>
          </div>

          <div className="flex gap-2 pt-1">
            <Button onClick={onClose} variant="ghost" fullWidth size="sm">Cancel</Button>
            <Button onClick={handleSave} fullWidth size="sm" disabled={!name.trim() || !!nameError || saving}>
              {saving ? "Saving..." : isEdit ? "Save" : "Create"}
            </Button>
          </div>
        </div>
      </Modal>

      <ModelSelectModal
        isOpen={showModelSelect}
        onClose={() => setShowModelSelect(false)}
        onSelect={handleAddModel}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Add Model to Combo"
      />
    </>
  );
}
