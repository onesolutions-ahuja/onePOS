import { listPaymentMethods } from "./paymentMethods.js";
import { classifyAdjustmentReason, resolveAdjustmentReason } from "./adjustmentReasons.js";
import { checkCreditLimit, checkPayment, validateCreditLimit, generateStatement } from "./customerCredit.js";
import { validateRedemption, validateIssueValue, validateTopUp, normaliseGiftCardCode } from "./giftCards.js";
import { planReceipt } from "./purchasing.js";
import { canTransition, resolveNextStatus } from "./onlineOrders/genericOrderTypes.js";
import { dispatchEmailInvoiceDelivery, dispatchSmsInvoiceDelivery, resendInvoiceByChannel } from "./invoiceDelivery.js";
import { dispatchWhatsAppInvoiceDelivery, resendWhatsAppInvoice } from "./whatsappDelivery.js";
import { submitPlatformApproval, decidePlatformApproval } from "./platformApprovals.js";
import { resolvePrice, applyDiscount, applyQuantityOffer, activeAt as pricingActiveAt } from "./pricingEngine.js";
import { invoiceStatus, allocateSupplierPayment } from "./supplierAccounts.js";
import { classifyLowStock, lowStockRow, fefoCompare, expiryStatus, createInventoryMovement, rebuildInventoryBalances, reconcileInventoryBalances, receiveInventoryBatch, allocateBatchConsumption, consumeInventoryBatch, syncBatchMovement } from "./inventory.js";
import { classifyReplenishment, replenishmentRow } from "./replenishment.js";
import { inventoryValue, valuationRow } from "./inventoryValuation.js";
import { validateComboDealInput, applyComboDeals, filterApplicableDeals } from "./comboPricing.js";
import { calculateTillCash, calculateTillClose, validateCashMovement } from "./tillRules.js";
import { allocateRefund, remainingRefundable } from "./paymentRefunds.js";
import { validateTenderLines } from "./paymentTender.js";
import { calculateExchangeSettlement } from "./exchangeRules.js";
import { syncCanonicalSaleTransaction, createCanonicalRelatedTransaction } from "./canonicalTransactions.js";
import { calculateLayawayBalance, validateLayawayDeposit, validateLayawayPayment, canCompleteLayaway } from "./layawayRules.js";
import { normaliseSupplierFeed } from "./supplierFeedAdapter.js";
import { matchSupplierFeed } from "./supplierFeedMatch.js";
import { receivePurchase } from "./purchaseReceiving.js";
import { executeSupplierPayment } from "./supplierPaymentExecution.js";
import { buildCreditSaleTransaction, buildPaymentTransaction, buildAdjustmentTransaction, buildOpeningBalanceTransaction, calculateBalance, normalizeCreditLedgerTransaction } from "./customerCredit.js";
import { calculateLoyaltyEarn, calculateLoyaltyRedemption, calculateLoyaltyReversal } from "./loyaltyRules.js";
import { calculateTax } from "./taxRules.js";
import { createGenericOrder, transitionGenericOrder } from "./onlineOrders/genericOrderService.js";
import { createSaleForCompletedOrder } from "./onlineOrders/saleCreator.js";
import { dispatchIntegrationEvent, getIntegrationDispatchStatus } from "./integrationDispatcher.js";
import { normalizeEmail, isValidEmail, findNormalizedEmailConflict } from "./userIdentity.js";
import { redactAuditDetails } from "./auditLog.js";
import { clockInAttendance, clockOutAttendance } from "./attendanceActions.js";
import { domainAllowed, issueAccountToken, pendingPolicies } from "./accountPolicy.js";
import { buildKitchenPrintPayload, validateQrOrderItems } from "./hospitalityActions.js";

// Canonical reusable functions. Pages, buttons and workflows reference these
// keys; implementation lives here or delegates to the authoritative domain service.
export const PLATFORM_FUNCTIONS = Object.freeze([
  { key: "hospitality.kitchen.print_payload", category: "HOSPITALITY", description: "Build the canonical printable kitchen-ticket payload for configured printer/browser output.", inputs: { type: "object", required: ["ticket"] }, outputs: { type: "object" }, permissions: ["hospitality.kds.view"], handler: async ({ inputs = {} }) => buildKitchenPrintPayload(inputs.ticket || {}) },
  { key: "hospitality.qr.items.validate", category: "HOSPITALITY", description: "Validate QR table-order item references before server-side product resolution.", inputs: { type: "object", required: ["items"] }, outputs: { type: "array" }, permissions: ["functions.execute"], handler: async ({ inputs = {} }) => validateQrOrderItems(inputs.items) },
  {
    key: "safe_echo",
    category: "SYSTEM",
    description: "Example safe function used by workflow tests.",
    inputs: { type: "object", properties: { value: { type: "string" } } },
    outputs: { type: "object" },
    permissions: ["functions.execute"],
    validation: (input) => {
      if (!input || typeof input !== "object") throw new Error("safe_echo requires an object input");
      if (typeof input.value !== "string") throw new Error("safe_echo requires a string value");
    },
    handler: async ({ inputs = {} }) => ({ ok: true, value: inputs.value || "" }),
  },
  {
    key: "payment.methods.list",
    category: "PAYMENTS",
    description: "Return the company's canonical configured payment methods.",
    inputs: { type: "object", properties: { activeOnly: { type: "boolean" } } },
    outputs: { type: "array" },
    permissions: ["functions.execute"],
    handler: async ({ inputs = {}, db, companyId, req }) => listPaymentMethods(db, companyId || req?.user?.companyId, { activeOnly: inputs.activeOnly !== false }),
  },
  {
    key: "payment.method.validate",
    category: "PAYMENTS",
    description: "Validate a payment method against company-configured Payment Method records.",
    inputs: { type: "object", required: ["code"], properties: { code: { type: "string" } } },
    outputs: { type: "object" },
    permissions: ["functions.execute"],
    validation: (input) => { if (!input?.code) throw new Error("payment.method.validate requires code"); },
    handler: async ({ inputs = {}, db, companyId, req }) => {
      const methods = await listPaymentMethods(db, companyId || req?.user?.companyId);
      const method = methods.find((item) => item.code === String(inputs.code));
      return { valid: Boolean(method), method: method || null };
    },
  },
  {
    key: "inventory.adjustment.reason.resolve",
    category: "INVENTORY",
    description: "Resolve the canonical stock-adjustment reason and movement classification.",
    inputs: { type: "object", required: ["quantity"], properties: { quantity: { type: "number" }, reason: { type: "string" } } },
    outputs: { type: "object" },
    permissions: ["inventory.adjust"],
    handler: async ({ inputs = {} }) => ({ classification: classifyAdjustmentReason(inputs.reason), reason: resolveAdjustmentReason(Number(inputs.quantity), inputs.reason) }),
  },
  {
    key: "customer.credit.limit.check",
    category: "CUSTOMER_CREDIT",
    description: "Run the canonical customer-credit limit check.",
    inputs: { type: "object", required: ["currentBalanceCents", "saleAmountCents", "creditLimitCents"] },
    outputs: { type: "object" },
    permissions: ["customer_credit.use"],
    handler: async ({ inputs = {} }) => checkCreditLimit(Number(inputs.currentBalanceCents), Number(inputs.saleAmountCents), Number(inputs.creditLimitCents)),
  },
  {
    key: "customer.credit.payment.check",
    category: "CUSTOMER_CREDIT",
    description: "Validate a customer-credit payment against the canonical ledger rules.",
    inputs: { type: "object", required: ["currentBalanceCents", "paymentAmountCents"] },
    outputs: { type: "object" },
    permissions: ["customer_credit.use"],
    handler: async ({ inputs = {} }) => checkPayment(Number(inputs.currentBalanceCents), Number(inputs.paymentAmountCents)),
  },
  {
    key: "customer.credit.limit.validate",
    category: "CUSTOMER_CREDIT",
    description: "Validate a configured customer credit limit.",
    inputs: { type: "object", required: ["limit"] }, outputs: { type: "object" }, permissions: ["customer_credit.manage"],
    handler: async ({ inputs = {} }) => validateCreditLimit(inputs.limit),
  },
  {
    key: "customer.credit.statement.generate",
    category: "CUSTOMER_CREDIT",
    description: "Generate a customer-credit statement from canonical ledger inputs.",
    inputs: { type: "object" }, outputs: { type: "object" }, permissions: ["customer_credit.view"],
    handler: async ({ inputs = {} }) => generateStatement(inputs),
  },
  {
    key: "gift_card.code.normalize",
    category: "GIFT_CARDS",
    description: "Normalize a gift-card code using the canonical gift-card rules.",
    inputs: { type: "object", required: ["code"] }, outputs: { type: "string" }, permissions: ["gift_cards.use"],
    handler: async ({ inputs = {} }) => normaliseGiftCardCode(inputs.code),
  },
  {
    key: "gift_card.issue.validate",
    category: "GIFT_CARDS",
    description: "Validate a gift-card issue value.",
    inputs: { type: "object", required: ["value"] }, outputs: { type: "object" }, permissions: ["gift_cards.issue"],
    handler: async ({ inputs = {} }) => validateIssueValue(inputs.value),
  },
  {
    key: "gift_card.topup.validate",
    category: "GIFT_CARDS",
    description: "Validate a gift-card top-up value.",
    inputs: { type: "object", required: ["value"] }, outputs: { type: "object" }, permissions: ["gift_cards.topup"],
    handler: async ({ inputs = {} }) => validateTopUp(inputs.value),
  },
  {
    key: "gift_card.redemption.validate",
    category: "GIFT_CARDS",
    description: "Validate a gift-card redemption against the available balance.",
    inputs: { type: "object", required: ["balance", "amount"] }, outputs: { type: "object" }, permissions: ["gift_cards.redeem"],
    handler: async ({ inputs = {} }) => validateRedemption(inputs.balance, inputs.amount),
  },
  {
    key: "purchase.receipt.plan",
    category: "PURCHASING",
    description: "Build the canonical purchase-receipt plan used by receiving workflows.",
    inputs: { type: "object", required: ["lines"] }, outputs: { type: "array" }, permissions: ["purchases.receive"],
    handler: async ({ inputs = {} }) => planReceipt(inputs.lines || [], inputs.requestedItems || null),
  },
  {
    key: "online_order.transition.check",
    category: "ONLINE_ORDERS",
    description: "Check whether an online order status transition is allowed.",
    inputs: { type: "object", required: ["fulfilmentType", "fromStatus", "toStatus"] }, outputs: { type: "boolean" }, permissions: ["online_orders.manage"],
    handler: async ({ inputs = {} }) => canTransition(inputs.fulfilmentType, inputs.fromStatus, inputs.toStatus),
  },
  {
    key: "online_order.next_status.resolve",
    category: "ONLINE_ORDERS",
    description: "Resolve the canonical next status for an online order.",
    inputs: { type: "object", required: ["fulfilmentType", "currentStatus"] }, outputs: { type: "string" }, permissions: ["online_orders.manage"],
    handler: async ({ inputs = {} }) => resolveNextStatus(inputs.fulfilmentType, inputs.currentStatus),
  },
  {
    key: "invoice.email.send",
    category: "INVOICING",
    description: "Send a sale invoice through the configured email provider.",
    inputs: { type: "object", required: ["saleId"] }, outputs: { type: "object" }, permissions: ["invoice.send"],
    handler: async ({ inputs = {}, db, companyId, req, userId }) => dispatchEmailInvoiceDelivery({ db, saleId: inputs.saleId, companyId: companyId || req?.user?.companyId, storeId: inputs.storeId || req?.user?.storeId || null, userId: userId || req?.user?.id || null }),
  },
  {
    key: "invoice.sms.send",
    category: "INVOICING",
    description: "Send a sale invoice through the configured SMS provider.",
    inputs: { type: "object", required: ["saleId"] }, outputs: { type: "object" }, permissions: ["invoice.send"],
    handler: async ({ inputs = {}, db, companyId, req, userId }) => dispatchSmsInvoiceDelivery({ db, saleId: inputs.saleId, companyId: companyId || req?.user?.companyId, storeId: inputs.storeId || req?.user?.storeId || null, userId: userId || req?.user?.id || null }),
  },
  {
    key: "invoice.whatsapp.send",
    category: "INVOICING",
    description: "Send a sale invoice through the configured WhatsApp provider.",
    inputs: { type: "object", required: ["saleId"] }, outputs: { type: "object" }, permissions: ["invoice.send"],
    handler: async ({ inputs = {}, db, companyId, req, userId }) => dispatchWhatsAppInvoiceDelivery({ db, saleId: inputs.saleId, companyId: companyId || req?.user?.companyId, storeId: inputs.storeId || req?.user?.storeId || null, userId: userId || req?.user?.id || null }),
  },
  {
    key: "invoice.delivery.resend",
    category: "INVOICING",
    description: "Resend an invoice through EMAIL, SMS or WHATSAPP using the same canonical delivery services.",
    inputs: { type: "object", required: ["saleId", "channel"] }, outputs: { type: "object" }, permissions: ["invoice.send"],
    handler: async ({ inputs = {}, db, companyId, req, userId }) => String(inputs.channel || "").toUpperCase() === "WHATSAPP"
      ? resendWhatsAppInvoice({ db, saleId: inputs.saleId, companyId: companyId || req?.user?.companyId, storeId: inputs.storeId || req?.user?.storeId || null, userId: userId || req?.user?.id || null })
      : resendInvoiceByChannel({ db, channel: inputs.channel, saleId: inputs.saleId, companyId: companyId || req?.user?.companyId, storeId: inputs.storeId || req?.user?.storeId || null, userId: userId || req?.user?.id || null, overrideRecipient: inputs.recipient || null }),
  },
  {
    key: "pricing.resolve", category: "PRICING", description: "Resolve canonical unit/quantity pricing, promotions and price-list precedence.",
    inputs: { type: "object", required: ["basePrice"] }, outputs: { type: "object" }, permissions: ["sales.use"],
    handler: async ({ inputs = {} }) => resolvePrice(inputs),
  },
  {
    key: "pricing.discount.apply", category: "PRICING", description: "Apply the canonical promotion discount calculation.",
    inputs: { type: "object", required: ["price"] }, outputs: { type: "number" }, permissions: ["sales.use"],
    handler: async ({ inputs = {} }) => applyDiscount(inputs.price, inputs.promotion || null),
  },
  {
    key: "pricing.quantity_offer.apply", category: "PRICING", description: "Apply the canonical multi-buy/quantity-offer calculation.",
    inputs: { type: "object", required: ["quantity", "price"] }, outputs: { type: "object" }, permissions: ["sales.use"],
    handler: async ({ inputs = {} }) => applyQuantityOffer(Number(inputs.quantity), Number(inputs.price), inputs.offer || null),
  },
  {
    key: "pricing.schedule.active", category: "PRICING", description: "Evaluate whether a scheduled price/promotion is active at a point in time.",
    inputs: { type: "object", required: ["row"] }, outputs: { type: "boolean" }, permissions: ["sales.use"],
    handler: async ({ inputs = {} }) => pricingActiveAt(inputs.row, inputs.at || new Date()),
  },
  {
    key: "supplier.invoice.status.resolve", category: "SUPPLIER_ACCOUNTING", description: "Resolve OPEN/PARTIALLY_PAID/PAID using canonical supplier-account rules.",
    inputs: { type: "object", required: ["total", "paid"] }, outputs: { type: "string" }, permissions: ["supplier_accounts.view"],
    handler: async ({ inputs = {} }) => invoiceStatus(inputs.total, inputs.paid),
  },
  {
    key: "supplier.payment.allocate", category: "SUPPLIER_ACCOUNTING", description: "Allocate a supplier payment across invoices using the canonical allocation rule.",
    inputs: { type: "object", required: ["amount", "invoices"] }, outputs: { type: "array" }, permissions: ["supplier_accounts.pay"],
    handler: async ({ inputs = {} }) => allocateSupplierPayment(inputs.amount, inputs.invoices),
  },
  {
    key: "inventory.low_stock.classify", category: "INVENTORY", description: "Evaluate canonical low-stock status.",
    inputs: { type: "object", required: ["product"] }, outputs: { type: "object" }, permissions: ["inventory.view"],
    handler: async ({ inputs = {} }) => classifyLowStock(inputs.product),
  },
  {
    key: "inventory.low_stock.row", category: "INVENTORY", description: "Build the canonical low-stock presentation row.",
    inputs: { type: "object", required: ["product"] }, outputs: { type: "object" }, permissions: ["inventory.view"],
    handler: async ({ inputs = {} }) => lowStockRow(inputs.product),
  },
  {
    key: "inventory.batch.expiry_status", category: "INVENTORY", description: "Resolve canonical batch expiry status.",
    inputs: { type: "object", required: ["expiryDate"] }, outputs: { type: "object" }, permissions: ["inventory.view"],
    handler: async ({ inputs = {} }) => expiryStatus(inputs.expiryDate, { expiringSoonDays: Number(inputs.expiringSoonDays || 7), ...(inputs.now ? { now: new Date(inputs.now) } : {}) }),
  },
  {
    key: "inventory.batch.fefo_sort", category: "INVENTORY", description: "Sort inventory batches in canonical FEFO consumption order.",
    inputs: { type: "object", required: ["batches"] }, outputs: { type: "array" }, permissions: ["inventory.view"],
    handler: async ({ inputs = {} }) => [...(inputs.batches || [])].sort(fefoCompare),
  },
  {
    key: "inventory.replenishment.classify", category: "INVENTORY", description: "Calculate canonical replenishment eligibility and suggested quantity.",
    inputs: { type: "object", required: ["product"] }, outputs: { type: "object" }, permissions: ["inventory.view"],
    handler: async ({ inputs = {} }) => classifyReplenishment(inputs.product),
  },
  {
    key: "inventory.replenishment.row", category: "INVENTORY", description: "Build the canonical replenishment suggestion row.",
    inputs: { type: "object", required: ["product"] }, outputs: { type: "object" }, permissions: ["inventory.view"],
    handler: async ({ inputs = {} }) => replenishmentRow(inputs.product),
  },
  {
    key: "inventory.valuation.calculate", category: "INVENTORY", description: "Calculate canonical inventory value from quantity and unit cost.",
    inputs: { type: "object", required: ["quantity", "unitCost"] }, outputs: { type: "number" }, permissions: ["inventory.view"],
    handler: async ({ inputs = {} }) => inventoryValue(inputs.quantity, inputs.unitCost),
  },
  {
    key: "inventory.valuation.row", category: "INVENTORY", description: "Build the canonical inventory valuation row.",
    inputs: { type: "object", required: ["row"] }, outputs: { type: "object" }, permissions: ["inventory.view"],
    handler: async ({ inputs = {} }) => valuationRow(inputs.row),
  },
  {
    key: "combo_deal.validate", category: "PRICING", description: "Validate combo/meal-deal metadata using the canonical rules.",
    inputs: { type: "object", required: ["deal"] }, outputs: { type: "object" }, permissions: ["promotions.manage"],
    handler: async ({ inputs = {} }) => validateComboDealInput(inputs.deal),
  },
  {
    key: "combo_deal.filter", category: "PRICING", description: "Filter combo deals by canonical activity/store applicability rules.",
    inputs: { type: "object", required: ["deals"] }, outputs: { type: "array" }, permissions: ["sales.use"],
    handler: async ({ inputs = {} }) => filterApplicableDeals(inputs.deals, inputs.options || {}),
  },
  {
    key: "combo_deal.apply", category: "PRICING", description: "Apply canonical combo/meal-deal pricing to a basket.",
    inputs: { type: "object", required: ["basket", "deals"] }, outputs: { type: "object" }, permissions: ["sales.use"],
    handler: async ({ inputs = {} }) => applyComboDeals(inputs.basket, inputs.deals, inputs.options || {}),
  },
  { key: "layaway.balance.calculate", category: "LAYAWAY", description: "Calculate canonical layaway paid and outstanding balances.", inputs: { type: "object", required: ["total"] }, outputs: { type: "object" }, permissions: ["layaway.view"], handler: async ({ inputs = {} }) => calculateLayawayBalance(inputs.total, inputs.paidAmount || 0) },
  { key: "layaway.deposit.validate", category: "LAYAWAY", description: "Validate a layaway deposit against the transaction total.", inputs: { type: "object", required: ["total"] }, outputs: { type: "object" }, permissions: ["layaway.create"], handler: async ({ inputs = {} }) => validateLayawayDeposit(inputs.total, inputs.deposit || 0) },
  { key: "layaway.payment.validate", category: "LAYAWAY", description: "Validate a payment against a layaway outstanding balance.", inputs: { type: "object", required: ["balance", "amount"] }, outputs: { type: "object" }, permissions: ["layaway.payment"], handler: async ({ inputs = {} }) => validateLayawayPayment(inputs.balance, inputs.amount) },
  { key: "layaway.completion.check", category: "LAYAWAY", description: "Check whether a layaway record is eligible for completion.", inputs: { type: "object", required: ["layaway"] }, outputs: { type: "boolean" }, permissions: ["layaway.complete"], handler: async ({ inputs = {} }) => canCompleteLayaway(inputs.layaway) },
  { key: "supplier.feed.normalize", category: "PURCHASING", description: "Normalize an imported supplier feed into canonical supplier rows.", inputs: { type: "object", required: ["feed"] }, outputs: { type: "array" }, permissions: ["purchases.manage"], handler: async ({ inputs = {} }) => normaliseSupplierFeed(inputs.feed) },
  { key: "supplier.feed.match", category: "PURCHASING", description: "Match normalized supplier feed rows to company products using canonical matching rules.", inputs: { type: "object", required: ["rows", "products"] }, outputs: { type: "object" }, permissions: ["purchases.manage"], handler: async ({ inputs = {}, companyId, req }) => matchSupplierFeed(inputs.rows, { products: inputs.products, companyId: companyId || req?.user?.companyId }) },
  { key: "purchase.receive", category: "PURCHASING", description: "Execute canonical purchase receiving, including stock movement, batch receipt, receipt records and purchase status.", inputs: { type: "object", required: ["purchaseId"] }, outputs: { type: "object" }, permissions: ["purchases.receive"], handler: async ({ inputs = {}, client, companyId, userId, req }) => receivePurchase({ client, purchaseId: inputs.purchaseId, companyId: companyId || req?.user?.companyId, userId: userId || req?.user?.id, storeId: inputs.storeId || req?.user?.storeId, requestedItems: inputs.requestedItems || null, receiptMeta: inputs.receiptMeta || {}, createInventoryMovement }) },
  { key: "supplier.payment.execute", category: "SUPPLIER_ACCOUNTING", description: "Execute a supplier payment with tenant-safe invoice allocations, status updates and supplier ledger posting.", inputs: { type: "object", required: ["supplierId", "amount"] }, outputs: { type: "object" }, permissions: ["payment.manage"], handler: async ({ inputs = {}, client, companyId, userId, req }) => executeSupplierPayment({ client, companyId: companyId || req?.user?.companyId, userId: userId || req?.user?.id, defaultStoreId: req?.user?.storeId, input: inputs }) },
  { key: "customer.credit.transaction.build_sale", category: "CUSTOMER", description: "Build a canonical customer-credit sale ledger record.", inputs: { type: "object" }, outputs: { type: "object" }, permissions: ["customer_credit.use"], handler: async ({ inputs = {} }) => buildCreditSaleTransaction(inputs) },
  { key: "customer.credit.transaction.build_payment", category: "CUSTOMER", description: "Build a canonical customer-credit payment ledger record.", inputs: { type: "object" }, outputs: { type: "object" }, permissions: ["customer_credit.use"], handler: async ({ inputs = {} }) => buildPaymentTransaction(inputs) },
  { key: "customer.credit.transaction.build_adjustment", category: "CUSTOMER", description: "Build a canonical customer-credit adjustment ledger record.", inputs: { type: "object" }, outputs: { type: "object" }, permissions: ["customer_credit.manage"], handler: async ({ inputs = {} }) => buildAdjustmentTransaction(inputs) },
  { key: "customer.credit.transaction.build_opening_balance", category: "CUSTOMER", description: "Build a canonical customer-credit opening balance ledger record.", inputs: { type: "object" }, outputs: { type: "object" }, permissions: ["customer_credit.manage"], handler: async ({ inputs = {} }) => buildOpeningBalanceTransaction(inputs) },
  { key: "customer.credit.balance.calculate", category: "CUSTOMER", description: "Calculate customer-credit balance from canonical ledger records.", inputs: { type: "object", required: ["transactions"] }, outputs: { type: "number" }, permissions: ["customer_credit.view"], handler: async ({ inputs = {} }) => calculateBalance(inputs.transactions || []) },
  { key: "customer.credit.transaction.normalize", category: "CUSTOMER", description: "Normalize a customer-credit ledger record for API/UI consumption.", inputs: { type: "object", required: ["transaction"] }, outputs: { type: "object" }, permissions: ["customer_credit.view"], handler: async ({ inputs = {} }) => normalizeCreditLedgerTransaction(inputs.transaction, inputs.customer || null) },
  { key: "loyalty.earn.calculate", category: "LOYALTY", description: "Calculate loyalty earning from programme settings and transaction value.", inputs: { type: "object", required: ["saleTotal"] }, outputs: { type: "object" }, permissions: ["loyalty.use"], handler: async ({ inputs = {} }) => calculateLoyaltyEarn(inputs.saleTotal, inputs.programme || {}) },
  { key: "loyalty.redemption.calculate", category: "LOYALTY", description: "Validate and calculate a loyalty redemption.", inputs: { type: "object", required: ["balance", "requestedPoints"] }, outputs: { type: "object" }, permissions: ["loyalty.use"], handler: async ({ inputs = {} }) => calculateLoyaltyRedemption(inputs.balance, inputs.requestedPoints, inputs.programme || {}) },
  { key: "loyalty.reversal.calculate", category: "LOYALTY", description: "Calculate loyalty points to reverse for a refund without exceeding the current balance.", inputs: { type: "object", required: ["refundAmount", "currentBalance"] }, outputs: { type: "object" }, permissions: ["loyalty.use"], handler: async ({ inputs = {} }) => calculateLoyaltyReversal(inputs.refundAmount, inputs.currentBalance, inputs.programme || {}) },
  { key: "tax.calculate", category: "TAX", description: "Calculate canonical inclusive or exclusive tax values.", inputs: { type: "object", required: ["amount", "rate"] }, outputs: { type: "object" }, permissions: ["sales.use"], handler: async ({ inputs = {} }) => calculateTax(inputs.amount, inputs.rate, { inclusive: inputs.inclusive === true }) },
  { key: "online_order.create", category: "ONLINE_ORDER", description: "Create a canonical direct online-order record and reserve inventory.", inputs: { type: "object", required: ["externalOrderId", "fulfilmentType", "items"] }, outputs: { type: "object" }, permissions: ["online_orders.manage"], handler: async ({ inputs = {}, db, companyId, userId, req }) => createGenericOrder({ db, pool: db, companyId: companyId || req?.user?.companyId, userId: userId || req?.user?.id, storeId: inputs.storeId || req?.user?.storeId, externalOrderId: inputs.externalOrderId, fulfilmentType: inputs.fulfilmentType, items: inputs.items, customer: inputs.customer || {}, notes: inputs.notes, payment: inputs.payment, createInventoryMovement }) },
  { key: "online_order.transition", category: "ONLINE_ORDER", description: "Execute a canonical online-order lifecycle transition, including reservation release or sale creation when required.", inputs: { type: "object", required: ["orderId", "toStatus"] }, outputs: { type: "object" }, permissions: ["online_orders.manage"], handler: async ({ inputs = {}, db, companyId, userId, req }) => transitionGenericOrder({ pool: db, companyId: companyId || req?.user?.companyId, orderId: inputs.orderId, userId: userId || req?.user?.id, toStatus: inputs.toStatus, reason: inputs.reason || null, createSale: createSaleForCompletedOrder, createInventoryMovement }) },
  { key: "inventory.movement.create", category: "INVENTORY", description: "Create a canonical inventory movement.", inputs: { type: "object" }, outputs: { type: "object" }, permissions: ["inventory.adjust"], handler: async ({ inputs = {}, db }) => createInventoryMovement(db, inputs) },
  { key: "inventory.balance.rebuild", category: "INVENTORY", description: "Rebuild canonical inventory balances from movements.", inputs: { type: "object" }, outputs: { type: "object" }, permissions: ["inventory.adjust"], handler: async ({ inputs = {}, db, companyId, req }) => rebuildInventoryBalances(db, { ...inputs, companyId: companyId || req?.user?.companyId }) },
  { key: "inventory.balance.reconcile", category: "INVENTORY", description: "Reconcile canonical inventory balances against movements.", inputs: { type: "object" }, outputs: { type: "object" }, permissions: ["inventory.adjust"], handler: async ({ inputs = {}, db, companyId, req }) => reconcileInventoryBalances(db, { ...inputs, companyId: companyId || req?.user?.companyId }) },
  { key: "inventory.batch.receive", category: "INVENTORY", description: "Receive stock into the canonical batch ledger.", inputs: { type: "object" }, outputs: { type: "object" }, permissions: ["inventory.adjust"], handler: async ({ inputs = {}, db }) => receiveInventoryBatch(db, inputs) },
  { key: "inventory.batch.allocate_fefo", category: "INVENTORY", description: "Allocate batch consumption using canonical FEFO rules.", inputs: { type: "object" }, outputs: { type: "array" }, permissions: ["inventory.adjust"], handler: async ({ inputs = {}, db }) => allocateBatchConsumption(db, inputs) },
  { key: "inventory.batch.consume", category: "INVENTORY", description: "Consume stock from a canonical inventory batch.", inputs: { type: "object" }, outputs: { type: "object" }, permissions: ["inventory.adjust"], handler: async ({ inputs = {}, db }) => consumeInventoryBatch(db, inputs) },
  { key: "inventory.batch.sync_movement", category: "INVENTORY", description: "Synchronise batch state for a canonical inventory movement.", inputs: { type: "object" }, outputs: { type: "object" }, permissions: ["inventory.adjust"], handler: async ({ inputs = {}, db }) => syncBatchMovement(db, inputs) },
  { key: "till.cash.calculate", category: "TILL", description: "Calculate authoritative drawer cash from opening cash, movements, sales and refunds.", inputs: { type: "object" }, outputs: { type: "number" }, permissions: ["till.open"], handler: async ({ inputs = {} }) => calculateTillCash(inputs) },
  { key: "till.close.calculate", category: "TILL", description: "Calculate expected cash and close variance.", inputs: { type: "object" }, outputs: { type: "object" }, permissions: ["till.close"], handler: async ({ inputs = {} }) => calculateTillClose(inputs) },
  { key: "till.cash_movement.validate", category: "TILL", description: "Validate canonical cash-in/cash-out movement rules.", inputs: { type: "object" }, outputs: { type: "object" }, permissions: ["cash.adjustment"], handler: async ({ inputs = {} }) => validateCashMovement(inputs) },
  { key: "payment.tender.validate", category: "PAYMENTS", description: "Validate and normalize canonical single/split tender lines against configured payment methods and the transaction total.", inputs: { type: "object", required: ["payments", "total", "allowedMethods"] }, outputs: { type: "array" }, permissions: ["sale.create"], handler: async ({ inputs = {} }) => validateTenderLines(inputs) },
  { key: "payment.refund.remaining", category: "PAYMENTS", description: "Calculate the amount still refundable across the original tender methods.", inputs: { type: "object" }, outputs: { type: "number" }, permissions: ["sale.refund"], handler: async ({ inputs = {} }) => remainingRefundable(inputs.payments || [], inputs.refundedByMethod || {}) },
  { key: "payment.refund.allocate", category: "PAYMENTS", description: "Allocate a refund across original tender methods without exceeding their remaining refundable amounts.", inputs: { type: "object" }, outputs: { type: "object" }, permissions: ["sale.refund"], handler: async ({ inputs = {} }) => allocateRefund(inputs.payments || [], inputs.refundAmount, inputs.refundedByMethod || {}) },
  { key: "exchange.settlement.calculate", category: "SALES", description: "Calculate the canonical financial settlement for an exchange transaction record.", inputs: { type: "object" }, outputs: { type: "object" }, permissions: ["sale.refund"], handler: async ({ inputs = {} }) => calculateExchangeSettlement(inputs.returnTotal, inputs.replacementTotal) },
  { key: "transaction.sale.sync", category: "SALES", description: "Synchronise an existing sale/return/exchange record with the canonical transaction and financial-ledger model.", inputs: { type: "object", required: ["saleId"] }, outputs: { type: "object" }, permissions: ["sale.create"], handler: async ({ inputs = {}, db, companyId, req }) => syncCanonicalSaleTransaction(db, { ...inputs, companyId: companyId || req?.user?.companyId, storeId: inputs.storeId || req?.user?.storeId || null }) },
  { key: "transaction.related.create", category: "SALES", description: "Create a canonical related transaction record such as RETURN or EXCHANGE using the shared transaction model.", inputs: { type: "object", required: ["transactionType", "originalTransactionId", "referenceNumber"] }, outputs: { type: "string" }, permissions: ["sale.refund"], handler: async ({ inputs = {}, db, companyId, userId, req }) => createCanonicalRelatedTransaction(db, { ...inputs, companyId: companyId || req?.user?.companyId, userId: userId || req?.user?.id, storeId: inputs.storeId || req?.user?.storeId }) },
  { key: "attendance.clock_in", category: "STAFF", description: "Clock the authenticated user in using server-authoritative time and tenant/store context.", inputs: { type: "object" }, outputs: { type: "object" }, permissions: ["attendance.use"], handler: async ({ db, companyId, userId, req }) => clockInAttendance({ db, companyId: companyId || req?.user?.companyId, userId: userId || req?.user?.id, storeId: req?.user?.storeId }) },
  { key: "attendance.clock_out", category: "STAFF", description: "Clock the authenticated user out and calculate worked minutes from server timestamps.", inputs: { type: "object" }, outputs: { type: "object" }, permissions: ["attendance.use"], handler: async ({ db, companyId, userId, req }) => clockOutAttendance({ db, companyId: companyId || req?.user?.companyId, userId: userId || req?.user?.id }) },
  { key: "user.email.normalize", category: "SECURITY", description: "Normalize a user email using the canonical identity rules.", inputs: { type: "object", required: ["email"] }, outputs: { type: "string" }, permissions: ["users.manage"], handler: async ({ inputs = {} }) => normalizeEmail(inputs.email) },
  { key: "user.email.validate", category: "SECURITY", description: "Validate a normalized user email using the canonical identity rules.", inputs: { type: "object", required: ["email"] }, outputs: { type: "boolean" }, permissions: ["users.manage"], handler: async ({ inputs = {} }) => isValidEmail(normalizeEmail(inputs.email)) },
  { key: "user.email.conflict_check", category: "SECURITY", description: "Check whether a normalized email conflicts with another user identity.", inputs: { type: "object", required: ["email"] }, outputs: { type: "object" }, permissions: ["users.manage"], handler: async ({ inputs = {}, db }) => findNormalizedEmailConflict(db, normalizeEmail(inputs.email), inputs.excludedUserId || null) },
  { key: "integration.event.dispatch", category: "INTEGRATIONS", description: "Dispatch a registered business event through enabled company integrations without coupling domain routes to providers.", inputs: { type: "object", required: ["event", "entityId"] }, outputs: { type: "object" }, permissions: ["integrations.manage"], handler: async ({ inputs = {}, db, companyId, req }) => dispatchIntegrationEvent({ event: inputs.event, deps: { db }, context: { companyId: companyId || req?.user?.companyId, storeId: inputs.storeId || req?.user?.storeId }, entityId: inputs.entityId }) },
  { key: "integration.dispatch.status", category: "INTEGRATIONS", description: "Read canonical integration dispatch status for the current company/store.", inputs: { type: "object" }, outputs: { type: "array" }, permissions: ["integrations.view"], handler: async ({ inputs = {}, db, companyId, req }) => getIntegrationDispatchStatus({ deps: { db }, companyId: companyId || req?.user?.companyId, storeId: inputs.storeId || req?.user?.storeId || null }) },
  { key: "audit.details.redact", category: "SYSTEM", description: "Redact secrets and sensitive credential fields before audit persistence or display.", inputs: { type: "object", required: ["details"] }, outputs: { type: "object" }, permissions: ["audit.view"], handler: async ({ inputs = {} }) => redactAuditDetails(inputs.details) },
  { key: "user.domain.validate", category: "SECURITY", description: "Validate a user email against the company domain-user policy.", inputs: { type: "object", required: ["email"] }, outputs: { type: "boolean" }, permissions: ["users.manage"], handler: async ({ inputs = {} }) => domainAllowed(inputs.email, inputs.allowedDomain, inputs.enabled === true) },
  { key: "account.registration.token.issue", category: "SECURITY", description: "Issue a single-use expiring first-registration token for the user onboarding workflow.", inputs: { type: "object", required: ["userId"] }, outputs: { type: "string" }, permissions: ["users.manage"], handler: async ({ inputs = {}, db, companyId, req }) => issueAccountToken(db, { companyId: companyId || req?.user?.companyId, userId: inputs.userId, purpose: "REGISTRATION", expiresMinutes: inputs.expiresMinutes || 1440 }) },
  { key: "account.password_reset.token.issue", category: "SECURITY", description: "Issue a single-use expiring password-reset token for the configured reset workflow.", inputs: { type: "object", required: ["userId"] }, outputs: { type: "string" }, permissions: ["users.manage"], handler: async ({ inputs = {}, db, companyId, req }) => issueAccountToken(db, { companyId: companyId || req?.user?.companyId, userId: inputs.userId, purpose: "PASSWORD_RESET", expiresMinutes: inputs.expiresMinutes || 60 }) },
  { key: "policy.pending.list", category: "POLICY", description: "List active mandatory policy versions the current user still needs to accept.", inputs: { type: "object" }, outputs: { type: "array" }, permissions: ["functions.execute"], handler: async ({ db, companyId, userId, req }) => pendingPolicies(db, { companyId: companyId || req?.user?.companyId, userId: userId || req?.user?.id }) },
  {
    key: "approval.submit",
    category: "APPROVALS",
    description: "Submit a record to the canonical Platform approval engine.",
    inputs: { type: "object", required: ["recordId"] }, outputs: { type: "object" }, permissions: ["approvals.submit"],
    handler: async ({ inputs = {}, db, object, fields, record, req }) => submitPlatformApproval({ db, object: inputs.object || object, fields: inputs.fields || fields || [], recordId: inputs.recordId, record: inputs.record || record, req }),
  },
  {
    key: "approval.decide",
    category: "APPROVALS",
    description: "Approve or reject a Platform approval request.",
    inputs: { type: "object", required: ["requestId", "decision"] }, outputs: { type: "object" }, permissions: ["approvals.decide"],
    handler: async ({ inputs = {}, db, req }) => decidePlatformApproval({ db, requestId: inputs.requestId, decision: inputs.decision, comment: inputs.comment || null, req }),
  },
]);

const duplicates = PLATFORM_FUNCTIONS.map((item) => item.key).filter((key, index, all) => all.indexOf(key) !== index);
if (duplicates.length) throw new Error(`Duplicate registered function keys: ${[...new Set(duplicates)].join(", ")}`);
export const PLATFORM_FUNCTION_MAP = new Map(PLATFORM_FUNCTIONS.map((item) => [item.key, item]));
export function getPlatformFunction(key) { return PLATFORM_FUNCTION_MAP.get(String(key || "").trim()) || null; }
export function listPlatformFunctions() { return PLATFORM_FUNCTIONS.slice(); }
