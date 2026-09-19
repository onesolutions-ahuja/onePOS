/*
 * T10X - Accounting Export Dispatcher (provider-neutral dispatch layer).
 *
 * Consumes T10W normalizers and dispatches normalized accounting payloads to a
 * provider adapter boundary. This module contains NO provider-specific logic.
 *
 * Flow:
 *   OnePOS Transaction → T10W Normalization → Export Dispatcher → Adapter → Provider
 *
 * Idempotency: uses integration_api_logs architecture (entity_type + entity_id +
 * company_id + store_id). No new table is introduced.
 *
 * Error handling: dispatcher never throws; returns a structured result object.
  * Original transactions are never modified.
 */
import {
  ACCOUNTING_ENTITY_TYPES,
  sourceIdColumnFor,
} from './accountingExport.js';

/**
 * Generate a deterministic idempotency key for an accounting export.
 * Same company + provider + source_type + source_id → same key.
 * Different companies → different keys.
 */
export function idempotencyKey(companyId, storeId, entityType, sourceId, provider = 'default') {
  return `${companyId}|${provider}|${entityType}|${storeId || 'none'}|${sourceId}`;
}

/**
 * Provider adapter interface contract.
 * Providers implement: validateConfig(config), exportSale(payload), exportPurchase(payload),
 * exportRefund(payload), exportCustomerCredit(payload).
 * Each export* method should return { ok: true, externalReference?: string } on success,
 * or throw / return { ok: false, error: string } on failure.
 */

/**
 * Create an accounting export dispatcher.
 * @param {object} adapter - provider adapter (null = no provider configured)
 * @param {object} config - provider config (passed to validateConfig)
 * @param {object} options - { idempotencyTracker, onExport }
 * @returns {object} dispatcher with dispatch methods
 */
export function createAccountingDispatcher(adapter, config = null, options = {}) {
  const { idempotencyTracker, onExport } = options;

  /** Check if a payload has already been exported */
  function isDuplicateKey(key) {
    if (typeof idempotencyTracker === 'function') return idempotencyTracker(key);
    return false;
  }

  /**
   * Core dispatch logic - shared by all entity types.
   * Never throws; returns a structured result object.
   * Original transactions are never modified.
   */
  function dispatch(record, companyId, storeId, exportFn) {
    // 1. Validate record has required identity
    if (!record || !record.source_type || !record.source_id) {
      return {
        status: 'invalid_record',
        dispatched: false,
        payload: null,
        error: 'Record missing source_type or source_id',
        originalUnchanged: true,
      };
    }

    // 2. Build payload with company/store context (never trust record fields)
    const payload = {
      ...record,
      company_id: companyId,
      store_id: storeId || record.store_id || null,
    };

    // 3. Idempotency check
    const key = idempotencyKey(companyId, storeId, record.source_type, record.source_id);
    if (isDuplicateKey(key)) {
      return {
        status: 'duplicate',
        dispatched: false,
        payload,
        externalReference: null,
        idempotencyKey: key,
        originalUnchanged: true,
      };
    }

    // 4. Provider not configured
    if (!adapter || typeof exportFn !== 'function') {
      const result = {
        status: 'provider_not_configured',
        dispatched: false,
        payload,
        externalReference: null,
        idempotencyKey: key,
        originalUnchanged: true,
      };
      if (typeof onExport === 'function') onExport(result);
      return result;
    }

    // 5. Validate config
    if (typeof adapter.validateConfig === 'function' && !adapter.validateConfig(config)) {
      const result = {
        status: 'provider_not_configured',
        dispatched: false,
        payload,
        externalReference: null,
        idempotencyKey: key,
        originalUnchanged: true,
      };
      if (typeof onExport === 'function') onExport(result);
      return result;
    }

    // 6. Dispatch to adapter
    try {
      const adapterResult = exportFn(payload);

      // Handle async adapter results
      if (adapterResult && typeof adapterResult.then === 'function') {
        return {
          status: 'dispatched_async',
          dispatched: true,
          payload,
          idempotencyKey: key,
          promise: adapterResult.then((r) => {
            if (r && r.ok === false) {
              return { status: 'provider_rejected', dispatched: false, payload, error: r.error, idempotencyKey: key, originalUnchanged: true };
            }
            return { status: 'dispatched', dispatched: true, payload, externalReference: r?.externalReference || null, idempotencyKey: key, originalUnchanged: true };
          }).catch((err) => ({
            status: 'provider_error',
            dispatched: false,
            payload,
            error: err.message || String(err),
            idempotencyKey: key,
            originalUnchanged: true,
          })),
          originalUnchanged: true,
        };
      }

      // Sync result
      if (adapterResult && adapterResult.ok === false) {
        const result = {
          status: 'provider_rejected',
          dispatched: false,
          payload,
          error: adapterResult.error || 'Provider rejected the export',
          idempotencyKey: key,
          originalUnchanged: true,
        };
        if (typeof onExport === 'function') onExport(result);
        return result;
      }

      const result = {
        status: 'dispatched',
        dispatched: true,
        payload,
        externalReference: adapterResult?.externalReference || null,
        idempotencyKey: key,
        originalUnchanged: true,
      };
      if (typeof onExport === 'function') onExport(result);
      return result;
    } catch (err) {
      const result = {
        status: 'provider_error',
        dispatched: false,
        payload,
        error: err.message || String(err),
        idempotencyKey: key,
        originalUnchanged: true,
      };
      if (typeof onExport === 'function') onExport(result);
            return result;
    }
  }

  return {
    dispatchSale: (saleRecord, companyId, storeId) =>
      dispatch(saleRecord, companyId, storeId, adapter?.exportSale),

    dispatchPurchase: (purchaseRecord, companyId, storeId) =>
      dispatch(purchaseRecord, companyId, storeId, adapter?.exportPurchase),

    dispatchRefund: (refundRecord, companyId, storeId) =>
      dispatch(refundRecord, companyId, storeId, adapter?.exportRefund),

    dispatchCustomerCredit: (creditRecord, companyId, storeId) =>
      dispatch(creditRecord, companyId, storeId, adapter?.exportCustomerCredit),

    idempotencyKey: (companyId, storeId, sourceId, entityType) =>
      idempotencyKey(companyId, storeId, entityType, sourceId),
    sourceIdColumnFor,
    ACCOUNTING_ENTITY_TYPES,
  };
}

/** Safe no-op adapter - always rejects. Use as a placeholder. */
export const noopAdapter = {
  name: 'noop',
  validateConfig: () => false,
  exportSale: () => { throw new Error('no-op adapter: no accounting provider configured'); },
  exportPurchase: () => { throw new Error('no-op adapter: no accounting provider configured'); },
  exportRefund: () => { throw new Error('no-op adapter: no accounting provider configured'); },
  exportCustomerCredit: () => { throw new Error('no-op adapter: no accounting provider configured'); },
};