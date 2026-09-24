import { X } from "lucide-react";

/*
 * "Complete order" modal with the handover OTP.
 *
 * Extracted from the admin page so the admin view and the restricted
 * processing view share the IDENTICAL completion behaviour:
 *   - the OTP is verified by the PLATFORM (Uber / Deliveroo), never by onePOS;
 *   - the order is only marked completed after the platform confirms;
 *   - "Complete" is the ONLY action that can ever ask for an OTP.
 *
 * Presentational + form only: the caller owns the OTP state (input/error/
 * busy), the otpRequired decision and the API call, exactly as before.
 */

export default function CompleteOrderModal({
  order,
  otpInput,
  onOtpChange,
  otpError,
  otpBusy,
  onSubmit,
  onClose,
}) {
  if (!order) return null;

  const platformName = order.platform === "uber" ? "Uber Eats" : "Deliveroo";
  const platformShort = order.platform === "uber" ? "Uber" : "Deliveroo";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !otpBusy && onClose()}>
      <div className="bg-white rounded-xl w-[440px] max-w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-lg">Complete order</h2>
            <p className="text-xs text-slate-500 mt-1">
              {platformName} order {order.external_order_id}
            </p>
          </div>
          <button onClick={() => !otpBusy && onClose()} disabled={otpBusy} className="p-2 hover:bg-slate-100 rounded"><X size={20} /></button>
        </div>
        <form onSubmit={onSubmit} className="p-5">
          <p className="text-sm text-slate-600 mb-1">Enter the handover OTP from the {platformShort} app/customer.</p>
          <p className="text-xs text-slate-400 mb-4">
            The OTP is verified by the {platformShort} platform
            {order.otp_code ? " (code was supplied with the order)" : " (no OTP was recorded on this order - in stub mode any code is accepted)"}.
            The order is only marked completed after the platform confirms.
          </p>
          {otpError && <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{otpError}</div>}
          <label className="block text-sm text-slate-600">
            <span className="block mb-1 font-medium">Handover OTP</span>
            <input autoFocus value={otpInput} onChange={(event) => onOtpChange(event.target.value)} placeholder="e.g. 1234" className="w-full h-12 px-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-lg tracking-[0.3em] font-mono" />
          </label>
          <div className="flex justify-end gap-2 mt-5">
            <button type="button" onClick={() => onClose()} disabled={otpBusy} className="h-10 px-4 border border-slate-200 rounded-lg text-sm hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={otpBusy || !otpInput.trim()} className="h-10 px-5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {otpBusy ? "Verifying with platform..." : "Verify & complete"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
