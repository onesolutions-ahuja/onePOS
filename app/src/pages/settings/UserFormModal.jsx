import StandardObjectFormModal from "../../components/platform/StandardObjectFormModal.jsx";

/**
 * User/Employee CRUD is a Platform Object operation.  Passwords, store access,
 * JARVES entitlement and other operational capabilities are registered actions
 * or relationships and must not grow a second user-edit form here.
 */
export default function UserFormModal({ form: record = {}, onClose, onSaved }) {
  return (
    <StandardObjectFormModal
      objectKey="employee"
      record={record}
      mode={record?.id ? "edit" : "create"}
      title={record?.id ? "Edit User" : "Add User"}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}
