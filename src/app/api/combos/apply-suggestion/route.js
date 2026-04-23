import { NextResponse } from "next/server";
import { createCombo, getComboByName, updateCombo } from "@/lib/localDb";
import { scoreCombo } from "@/lib/comboScoring";

const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

export async function POST(request) {
  try {
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const models = Array.isArray(body.models) ? body.models : [];

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    if (!VALID_NAME_REGEX.test(name)) {
      return NextResponse.json({ error: "Name can only contain letters, numbers, -, _ and ." }, { status: 400 });
    }

    if (models.length === 0) {
      return NextResponse.json({ error: "Models are required" }, { status: 400 });
    }

    const existing = await getComboByName(name);
    if (existing) {
      return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
    }

    const combo = await createCombo({
      name,
      models,
      category: "general",
      tags: [],
      description: body.profile ? `Suggested ${body.profile} combo` : "Suggested combo",
    });

    let updatedCombo = combo;
    const score = await scoreCombo(models, { timeout: 1000 });
    if (score) {
      updatedCombo = await updateCombo(combo.id, {
        autoGroupMeta: {
          ...score,
          source: "suggestion-apply",
        },
      });
    }

    return NextResponse.json(updatedCombo, { status: 201 });
  } catch (error) {
    console.log("Error applying suggestion:", error);
    return NextResponse.json({ error: "Failed to apply suggestion" }, { status: 500 });
  }
}
