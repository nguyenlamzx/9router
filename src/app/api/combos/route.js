import { NextResponse } from "next/server";
import { getCombos, createCombo, getComboByName } from "@/lib/localDb";

export const dynamic = "force-dynamic";

const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;
const VALID_TAG_REGEX = /^[a-zA-Z0-9_-]+$/;
const ALLOWED_CATEGORIES = ["coding", "writing", "analysis", "translation", "general"];

function normalizeComboMeta({ category, tags, description }) {
  const normalizedCategory = typeof category === "string" && category.trim() ? category.trim().toLowerCase() : null;
  if (normalizedCategory && !ALLOWED_CATEGORIES.includes(normalizedCategory)) {
    return { error: "Invalid category" };
  }

  if (tags !== undefined && !Array.isArray(tags)) {
    return { error: "Tags must be an array" };
  }

  const normalizedTags = [...new Set((tags || [])
    .map(tag => typeof tag === "string" ? tag.trim().toLowerCase() : "")
    .filter(Boolean))];

  if (normalizedTags.length > 10) {
    return { error: "Tags cannot exceed 10 items" };
  }

  const hasInvalidTag = normalizedTags.some(tag => tag.length > 30 || !VALID_TAG_REGEX.test(tag));
  if (hasInvalidTag) {
    return { error: "Each tag must match [a-zA-Z0-9_-] and be at most 30 characters" };
  }

  const normalizedDescription = typeof description === "string" ? description.trim() : "";
  if (normalizedDescription.length > 200) {
    return { error: "Description must be at most 200 characters" };
  }

  return {
    category: normalizedCategory,
    tags: normalizedTags,
    description: normalizedDescription,
  };
}

// GET /api/combos - Get all combos
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category")?.trim().toLowerCase() || "";
    const tagsParam = searchParams.get("tags") || "";
    const requestedTags = tagsParam
      .split(",")
      .map(tag => tag.trim().toLowerCase())
      .filter(Boolean);

    let combos = await getCombos();

    if (category) {
      combos = combos.filter(combo => (combo.category || "").toLowerCase() === category);
    }

    if (requestedTags.length > 0) {
      combos = combos.filter(combo => {
        const comboTags = Array.isArray(combo.tags) ? combo.tags.map(tag => String(tag).toLowerCase()) : [];
        return requestedTags.every(tag => comboTags.includes(tag));
      });
    }

    return NextResponse.json({ combos });
  } catch (error) {
    console.log("Error fetching combos:", error);
    return NextResponse.json({ error: "Failed to fetch combos" }, { status: 500 });
  }
}

// POST /api/combos - Create new combo
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, models, category, tags, description } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    if (!VALID_NAME_REGEX.test(name)) {
      return NextResponse.json({ error: "Name can only contain letters, numbers, -, _ and ." }, { status: 400 });
    }

    const meta = normalizeComboMeta({ category, tags, description });
    if (meta.error) {
      return NextResponse.json({ error: meta.error }, { status: 400 });
    }

    const existing = await getComboByName(name);
    if (existing) {
      return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
    }

    const combo = await createCombo({ name, models: models || [], ...meta });

    return NextResponse.json(combo, { status: 201 });
  } catch (error) {
    console.log("Error creating combo:", error);
    return NextResponse.json({ error: "Failed to create combo" }, { status: 500 });
  }
}
