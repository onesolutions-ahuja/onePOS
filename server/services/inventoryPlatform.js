import {
  createInventoryMovement,
  rebuildInventoryBalances,
  reconcileInventoryBalances,
  inventoryMovementTypes,
} from "./inventory.js";

const ACTION_TYPES = new Set([
  "ADJUSTMENT_IN",
  "ADJUSTMENT_OUT",
  "WASTAGE",
  "SHRINKAGE",
  "OPENING",
  "TRANSFER",
  "RECONCILE",
  "REBUILD",
]);

function requireScope(action, companyId) {
  if (!companyId || (action.companyId && String(action.companyId) !== String(companyId))) {
    throw new Error("Inventory action company scope is invalid");
  }
}

function movementTypeFor(action) {
  const type = String(action.type || action.action || "").toUpperCase();
  if (type === "WASTAGE" || type === "SHRINKAGE") return "ADJUSTMENT_OUT";
  if (type === "OPENING") return "OPENING";
  if (!inventoryMovementTypes.has(type)) return type;
  return type;
}

async function assertStoreCompany(client, companyId, storeId) {
  if (!storeId) throw new Error("Store is required for inventory actions");
  const result = await client.query(
    "SELECT id FROM stores WHERE id=$1 AND company_id=$2 AND active=true LIMIT 1",
    [storeId, companyId]
  );
  if (!result.rows.length) throw new Error("Store is not in the company scope");
}

export async function executeInventoryPlatformAction({
  client,
  action,
  companyId,
  userId = null,
  inventoryMovement = createInventoryMovement,
}) {
  if (!client?.query) throw new Error("Inventory action database client is unavailable");
  const normalized = String(action?.type || action?.action || "").toUpperCase();
  if (!ACTION_TYPES.has(normalized)) throw new Error(`Unsupported inventory action: ${normalized}`);
  requireScope(action || {}, companyId);

  if (normalized === "RECONCILE") {
    const rows = await reconcileInventoryBalances({ query: client.query.bind(client) }, {
      companyId,
      storeId: action.storeId || null,
      productId: action.productId || null,
    });
    return { status: "completed", rows, discrepancies: rows.filter((row) => Number(row.discrepancy) !== 0) };
  }
  if (normalized === "REBUILD") {
    const rows = await rebuildInventoryBalances(client, {
      companyId,
      storeId: action.storeId || null,
      productId: action.productId || null,
    });
    return { status: "completed", rows };
  }

  if (normalized === "TRANSFER") {
    if (String(action.fromStoreId) === String(action.toStoreId)) throw new Error("Transfer stores must be different");
    await assertStoreCompany(client, companyId, action.fromStoreId);
    await assertStoreCompany(client, companyId, action.toStoreId);
    const quantity = Number(action.quantity);
    if (!action.productId || !Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("Transfer requires product and a positive quantity");
    }
    const referenceId = action.referenceId || null;
    const common = {
      companyId,
      productId: action.productId,
      referenceType: "STOCK_TRANSFER",
      referenceId,
      notes: action.notes || null,
      createdBy: userId,
    };
    const out = await inventoryMovement(client, {
      ...common, storeId: action.fromStoreId, movementType: "TRANSFER_OUT", quantityChange: -quantity,
    });
    const incoming = await inventoryMovement(client, {
      ...common, storeId: action.toStoreId, movementType: "TRANSFER_IN", quantityChange: quantity,
    });
    return { status: "completed", source: out.movement, destination: incoming.movement };
  }

  await assertStoreCompany(client, companyId, action.storeId);
  const quantity = Number(action.quantity);
  if (!action.productId || !Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("Inventory action requires product and a positive quantity");
  }
  const type = movementTypeFor({ ...action, type: normalized });
  const sign = ["ADJUSTMENT_OUT", "WASTAGE", "SHRINKAGE", "TRANSFER_OUT", "SALE", "RETURN_OUT"].includes(normalized) ? -1 : 1;
  const result = await inventoryMovement(client, {
    companyId,
    productId: action.productId,
    storeId: action.storeId,
    movementType: type,
    quantityChange: sign * quantity,
    referenceType: action.referenceType || "PLATFORM_ACTION",
    referenceId: action.referenceId || null,
    reason: action.reason || (normalized === "WASTAGE" ? "Wastage" : normalized === "SHRINKAGE" ? "Shrinkage" : null),
    notes: action.notes || null,
    createdBy: userId,
  });
  return { status: "completed", movement: result.movement, balance: result.balance, storeBalance: result.storeBalance };
}
