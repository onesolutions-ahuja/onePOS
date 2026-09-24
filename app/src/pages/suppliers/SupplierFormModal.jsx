import StandardObjectFormModal from "../../components/platform/StandardObjectFormModal.jsx";

export default function SupplierFormModal({ supplier, onClose, onSaved }) {
  return (
    <StandardObjectFormModal
      objectKey="supplier"
      record={supplier}
      mode={supplier?.id ? "edit" : "create"}
      title={supplier?.id ? "Edit Supplier" : "New Supplier"}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}
