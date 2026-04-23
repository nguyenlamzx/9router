/**
 * Combo Scoring Engine
 * Deterministic scoring cho auto-group và suggest combos
 */

import { getPricingForModel } from "@/shared/constants/pricing.js";
import { getProviderConnections } from "@/lib/localDb.js";
import { getUsageDb } from "@/lib/usageDb.js";
import { getRequestDetails } from "@/lib/requestDetailsDb.js";

const PROFILES = ["fast", "cheap", "balanced", "reliable"];

const PROFILE_WEIGHTS = {
  fast: { latency: 0.45, success: 0.20, provider: 0.20, cost: 0.15 },
  cheap: { cost: 0.50, success: 0.20, provider: 0.15, latency: 0.15 },
  balanced: { cost: 0.30, latency: 0.25, success: 0.30, provider: 0.15 },
  reliable: { success: 0.45, provider: 0.35, latency: 0.10, cost: 0.10 },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseModelString(modelStr) {
  const parts = modelStr.split("/");
  if (parts.length < 2) return { provider: null, model: modelStr };
  return { provider: parts[0], model: parts.slice(1).join("/") };
}

function normalizeModelName(modelId) {
  return (modelId || "").toLowerCase();
}

function getHeuristicBoost(modelId, profile) {
  const name = normalizeModelName(modelId);

  if (profile === "fast" || profile === "cheap") {
    if (/mini|flash|lite|turbo|nano|spark/.test(name)) return 0.10;
  }

  if (profile === "reliable") {
    if (/pro|max|opus|reasoner|ultra/.test(name)) return 0.10;
  }

  return 0;
}

function normalizeCost(costPer1M) {
  if (costPer1M === null || costPer1M === undefined) return null;
  return clamp(1 - Math.log10(costPer1M + 1) / Math.log10(51), 0, 1);
}

function normalizeLatency(latencyMs) {
  if (latencyMs === null || latencyMs === undefined) return null;
  return clamp(1 - (latencyMs - 300) / (5000 - 300), 0, 1);
}

function normalizeSuccess(successRate) {
  if (successRate === null || successRate === undefined) return null;
  return clamp(successRate, 0, 1);
}

function normalizeProviderHealth(testStatus) {
  const mapping = {
    active: 1.0,
    success: 1.0,
    unknown: 0.6,
    rate_limited: 0.4,
    failed: 0.1,
    error: 0.1,
    unavailable: 0.1,
  };
  return mapping[testStatus] || 0.6;
}

async function getModelFeatures(provider, model) {
  const features = {
    avgCostPer1M: null,
    avgLatencyMs: null,
    successRate: null,
    providerHealthRate: null,
    heuristicBoost: 0,
  };

  try {
    const pricing = await getPricingForModel(provider, model);
    if (pricing) {
      features.avgCostPer1M = (pricing.input + pricing.output) / 2;
    }
  } catch (error) {
    console.warn(`[comboScoring] Pricing lookup failed for ${provider}/${model}:`, error.message);
  }

  try {
    const connections = await getProviderConnections({ provider, isActive: true });
    if (connections.length > 0) {
      const healthScores = connections.map(c => normalizeProviderHealth(c.testStatus || "unknown"));
      features.providerHealthRate = healthScores.reduce((sum, s) => sum + s, 0) / healthScores.length;
    }
  } catch (error) {
    console.warn(`[comboScoring] Provider health lookup failed for ${provider}:`, error.message);
  }

  try {
    const usageDb = await getUsageDb();
    await usageDb.read();
    const dailySummary = usageDb.data.dailySummary || {};

    let totalRequests = 0;
    let successRequests = 0;

    const recentDays = Object.keys(dailySummary).sort().slice(-7);
    for (const day of recentDays) {
      const dayData = dailySummary[day];
      const modelKey = `${model}|${provider}`;
      const modelStats = dayData.byModel?.[modelKey];
      if (modelStats) {
        totalRequests += modelStats.requests || 0;
      }
    }

    if (totalRequests > 0) {
      const { details } = await getRequestDetails({ provider, model, startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() });
      successRequests = details.filter(d => d.status === "success" || d.status === "ok" || !d.status).length;
      features.successRate = successRequests / Math.max(totalRequests, details.length);

      const latencies = details.filter(d => d.latency?.total).map(d => d.latency.total);
      if (latencies.length > 0) {
        latencies.sort((a, b) => a - b);
        features.avgLatencyMs = latencies[Math.floor(latencies.length * 0.5)];
      }
    }
  } catch (error) {
    console.warn(`[comboScoring] Usage/latency lookup failed for ${provider}/${model}:`, error.message);
  }

  return features;
}

function computeModelScore(features, profile) {
  const weights = PROFILE_WEIGHTS[profile];

  const costNorm = normalizeCost(features.avgCostPer1M);
  const latencyNorm = normalizeLatency(features.avgLatencyMs);
  const successNorm = normalizeSuccess(features.successRate);
  const providerNorm = features.providerHealthRate !== null ? features.providerHealthRate : 0.6;

  const availableWeights = {};
  let totalWeight = 0;

  if (costNorm !== null) { availableWeights.cost = weights.cost; totalWeight += weights.cost; }
  if (latencyNorm !== null) { availableWeights.latency = weights.latency; totalWeight += weights.latency; }
  if (successNorm !== null) { availableWeights.success = weights.success; totalWeight += weights.success; }
  availableWeights.provider = weights.provider;
  totalWeight += weights.provider;

  if (totalWeight === 0) return 50;

  let score = 0;
  if (costNorm !== null) score += (costNorm * availableWeights.cost / totalWeight);
  if (latencyNorm !== null) score += (latencyNorm * availableWeights.latency / totalWeight);
  if (successNorm !== null) score += (successNorm * availableWeights.success / totalWeight);
  score += (providerNorm * availableWeights.provider / totalWeight);

  score += features.heuristicBoost;

  return Math.round(clamp(score, 0, 1) * 100);
}

export async function scoreCombo(models, options = {}) {
  const timeout = options.timeout || 1000;
  const startTime = Date.now();

  const modelScores = [];

  for (const modelStr of models) {
    if (Date.now() - startTime > timeout) {
      console.warn(`[comboScoring] Timeout reached, skipping remaining models`);
      break;
    }

    const { provider, model } = parseModelString(modelStr);
    if (!provider || !model) {
      modelScores.push(null);
      continue;
    }

    const features = await getModelFeatures(provider, model);

    const scoreBreakdown = {};
    for (const profile of PROFILES) {
      features.heuristicBoost = getHeuristicBoost(model, profile);
      scoreBreakdown[profile] = computeModelScore(features, profile);
    }

    modelScores.push({ modelStr, features, scoreBreakdown });
  }

  const validScores = modelScores.filter(s => s !== null);
  if (validScores.length === 0) {
    return null;
  }

  const comboScoreBreakdown = {};
  for (const profile of PROFILES) {
    const weights = [0.5, 0.3, 0.2];
    let weightedSum = 0;
    let totalWeight = 0;

    for (let i = 0; i < Math.min(validScores.length, 3); i++) {
      const weight = weights[i];
      weightedSum += validScores[i].scoreBreakdown[profile] * weight;
      totalWeight += weight;
    }

    comboScoreBreakdown[profile] = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 50;
  }

  const topProfile = PROFILES.reduce((best, profile) =>
    comboScoreBreakdown[profile] > comboScoreBreakdown[best] ? profile : best
  );

  const aggregatedFeatures = {
    avgCostPer1M: null,
    avgLatencyMs: null,
    successRate: null,
    providerHealthRate: null,
    heuristicBoost: 0,
  };

  const costs = validScores.map(s => s.features.avgCostPer1M).filter(c => c !== null);
  if (costs.length > 0) aggregatedFeatures.avgCostPer1M = costs.reduce((sum, c) => sum + c, 0) / costs.length;

  const latencies = validScores.map(s => s.features.avgLatencyMs).filter(l => l !== null);
  if (latencies.length > 0) aggregatedFeatures.avgLatencyMs = latencies.reduce((sum, l) => sum + l, 0) / latencies.length;

  const successRates = validScores.map(s => s.features.successRate).filter(r => r !== null);
  if (successRates.length > 0) aggregatedFeatures.successRate = successRates.reduce((sum, r) => sum + r, 0) / successRates.length;

  const healthRates = validScores.map(s => s.features.providerHealthRate).filter(h => h !== null);
  if (healthRates.length > 0) aggregatedFeatures.providerHealthRate = healthRates.reduce((sum, h) => sum + h, 0) / healthRates.length;

  const usageSampleSize = validScores.reduce((sum, s) => sum + (s.features.successRate !== null ? 1 : 0), 0);

  return {
    version: 1,
    profile: topProfile,
    score: comboScoreBreakdown[topProfile],
    scoreBreakdown: comboScoreBreakdown,
    features: aggregatedFeatures,
    dataQuality: {
      usageSampleSize,
      hasPricingCoverage: costs.length > 0,
      hasProviderStatusCoverage: healthRates.length > 0,
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function suggestCombos(candidateModels, options = {}) {
  const maxModelsPerSuggestion = options.maxModelsPerSuggestion || 4;

  const modelFeatures = [];
  for (const modelStr of candidateModels) {
    const { provider, model } = parseModelString(modelStr);
    if (!provider || !model) continue;

    const features = await getModelFeatures(provider, model);
    modelFeatures.push({ modelStr, provider, model, features });
  }

  const profiles = {};

  for (const profile of PROFILES) {
    const scored = modelFeatures.map(mf => {
      const f = { ...mf.features, heuristicBoost: getHeuristicBoost(mf.model, profile) };
      return { ...mf, score: computeModelScore(f, profile) };
    }).sort((a, b) => b.score - a.score);

    const uniqueProviders = new Set();
    const selected = [];
    for (const item of scored) {
      if (selected.length >= maxModelsPerSuggestion) break;
      if (!uniqueProviders.has(item.provider)) {
        selected.push(item.modelStr);
        uniqueProviders.add(item.provider);
      }
    }

    const comboMeta = await scoreCombo(selected, { timeout: 500 });

    profiles[profile] = {
      profile,
      models: selected,
      score: comboMeta?.score || 50,
      rationale: buildRationale(profile, comboMeta),
      features: comboMeta?.features || {},
    };
  }

  return {
    profiles: PROFILES.map(p => profiles[p]),
    generatedAt: new Date().toISOString(),
  };
}

function buildRationale(profile, comboMeta) {
  const rationale = [];

  if (profile === "fast" && comboMeta?.features.avgLatencyMs) {
    rationale.push(`Avg latency ${Math.round(comboMeta.features.avgLatencyMs)}ms`);
  }

  if (profile === "cheap" && comboMeta?.features.avgCostPer1M) {
    rationale.push(`Avg cost $${comboMeta.features.avgCostPer1M.toFixed(2)}/1M tokens`);
  }

  if (profile === "reliable" && comboMeta?.features.successRate) {
    rationale.push(`${Math.round(comboMeta.features.successRate * 100)}% success rate`);
  }

  if (profile === "balanced") {
    rationale.push("Balanced cost, speed, and reliability");
  }

  if (comboMeta?.dataQuality.usageSampleSize > 0) {
    rationale.push(`Based on ${comboMeta.dataQuality.usageSampleSize} model(s) with usage data`);
  } else {
    rationale.push("Based on pricing and provider health");
  }

  return rationale;
}
