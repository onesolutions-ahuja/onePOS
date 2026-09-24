import StandardObjectFormModal from "../platform/StandardObjectFormModal.jsx";

export default function CustomerFormModal({ onClose, onSaved, customer = null }) {
  return (
    <StandardObjectFormModal
      objectKey="customer"
      record={customer}
      mode={customer ? "edit" : "quick_create"}
      title={customer ? "Edit Customer" : "New Customer"}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}
