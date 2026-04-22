import { NextResponse } from "next/server";
import { getComboById, updateCombo, deleteCombo, getComboByName } from "@/lib/localDb";

const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;
const VALID_TAG_REGEX = /^[a-zA-Z0-9_-]+$/;
const ALLOWED_CATEGORIES = ["coding", "writing", "analysis", "translation", "general"];

function normalizeComboMeta(payload) {
  const { category, tags, description } = payload;
  const normalizedCategory = typeof category === "string" && category.trim() ? category.trim().toLowerCase() : null;
  if (normalizedCategory && !ALLOWED_CATEGORIES.includes(normalizedCategory)) {
    return { error: "Invalid category" };
  }

  if (tags !== undefined && !Array.isArray(tags)) {
    return { error: "Tags must be an array" };
  }

  const normalizedTags = tags !== undefined
    ? [...new Set((tags)
        .map(tag => typeof tag === "string" ? tag.trim().toLowerCase() : "")
        .filter(Boolean))]
    : undefined;

  if (normalizedTags !== undefined) {
    if (normalizedTags.length > 10) {
      return { error: "Tags cannot exceed 10 items" };
    }
    const hasInvalidTag = normalizedTags.some(tag => tag.length > 30 || !VALID_TAG_REGEX.test(tag));
    if (hasInvalidTag) {
      return { error: "Each tag must match [a-zA-Z0-9_-] and be at most 30 characters" };
    }
  }

  const normalizedDescription = typeof description === "string" ? description.trim() : undefined;
  if (normalizedDescription !== undefined && normalizedDescription.length > 200) {
    return { error: "Description must be at most 200 characters" };
  }

  const result = {};
  if (Object.hasOwn(payload, "category")) result.category = normalizedCategory;
  if (normalizedTags !== undefined) result.tags = normalizedTags;
  if (normalizedDescription !== undefined) result.description = normalizedDescription;
  return result;
}

// GET /api/combos/[id] - Get combo by ID
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const combo = await getComboById(id);

    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }

    return NextResponse.json(combo);
  } catch (error) {
    console.log("Error fetching combo:", error);
    return NextResponse.json({ error: "Failed to fetch combo" }, { status: 500 });
  }
}

// PUT /api/combos/[id] - Update combo
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (body.name) {
      if (!VALID_NAME_REGEX.test(body.name)) {
        return NextResponse.json({ error: "Name can only contain letters, numbers, -, _ and ." }, { status: 400 });
      }

      const existing = await getComboByName(body.name);
      if (existing && existing.id !== id) {
        return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
      }
    }

    const { category, tags, description, ...rest } = body;
    const meta = normalizeComboMeta({ category, tags, description });
    if (meta.error) {
      return NextResponse.json({ error: meta.error }, { status: 400 });
    }

    const combo = await updateCombo(id, { ...rest, ...meta });

    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }

    return NextResponse.json(combo);
  } catch (error) {
    console.log("Error updating combo:", error);
    return NextResponse.json({ error: "Failed to update combo" }, { status: 500 });
  }
}

// DELETE /api/combos/[id] - Delete combo
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const success = await deleteCombo(id);
    
    if (!success) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting combo:", error);
    return NextResponse.json({ error: "Failed to delete combo" }, { status: 500 });
  }
}
