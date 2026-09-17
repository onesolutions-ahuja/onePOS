import React from "react";

function VisualFlow({ type }) {
  const flows = {
    whatsapp: {
      title: "WhatsApp Invoice Delivery Flow",
      steps: [
        { icon: "🖥️", label: "onePOS Sale", description: "Complete sale in onePOS" },
        { icon: "📄", label: "Invoice Generated", description: "PDF invoice created" },
        { icon: "💬", label: "WhatsApp", description: "Sent via WhatsApp" },
        { icon: "👤", label: "Customer", description: "Receives invoice" },
      ],
      description: "Automatically send invoices to customers via WhatsApp with secure links and PDF attachments."
    },
    "uber-eats": {
      title: "Uber Eats Order Flow",
      steps: [
        { icon: "🚗", label: "Uber Eats Order", description: "Order received from platform" },
        { icon: "🖥️", label: "onePOS", description: "Order appears in system" },
        { icon: "👨‍🍳", label: "Kitchen", description: "Preparation begins" },
        { icon: "📦", label: "Inventory", description: "Stock automatically updated" },
      ],
      description: "Seamlessly integrate Uber Eats orders into your workflow with automatic inventory sync."
    },
    deliveroo: {
      title: "Deliveroo Order Flow",
      steps: [
        { icon: "🥡", label: "Deliveroo Order", description: "Order received via webhook" },
        { icon: "🖥️", label: "onePOS", description: "Order processed in system" },
        { icon: "👨‍🍳", label: "Kitchen Display", description: "Order displayed for prep" },
        { icon: "📊", label: "Reporting", description: "Sales data consolidated" },
      ],
      description: "Streamline Deliveroo orders with real-time kitchen display and consolidated reporting."
    },
    "just-eat": {
      title: "Just Eat Order Flow",
      steps: [
        { icon: "🍔", label: "Just Eat Order", description: "Order received from platform" },
        { icon: "🖥️", label: "onePOS", description: "Integrated order management" },
        { icon: "👨‍🍳", label: "Preparation", description: "Kitchen workflow triggered" },
        { icon: "📦", label: "Inventory", description: "Stock levels updated" },
      ],
      description: "Manage Just Eat orders alongside in-store sales with unified inventory tracking."
    },
    shopify: {
      title: "Shopify Integration Flow",
      steps: [
        { icon: "🛍️", label: "Shopify Store", description: "Online order received" },
        { icon: "🖥️", label: "onePOS", description: "Order synced to system" },
        { icon: "📦", label: "Inventory", description: "Stock synchronized" },
        { icon: "📊", label: "Reporting", description: "Unified sales analytics" },
      ],
      description: "Connect your Shopify store for unified inventory and order management across channels."
    },
    accounting: {
      title: "Accounting Integration Flow",
      steps: [
        { icon: "🖥️", label: "onePOS", description: "Sales and purchase data" },
        { icon: "📊", label: "Accounting System", description: "Data synchronized" },
        { icon: "📈", label: "Financial Reports", description: "Automated reconciliation" },
        { icon: "✅", label: "Complete", description: "Financial accuracy ensured" },
      ],
      description: "Automate financial data flow between onePOS and your accounting software."
    },
    api: {
      title: "API Integration Flow",
      steps: [
        { icon: "🔌", label: "External System", description: "Third-party software" },
        { icon: "🔗", label: "onePOS API", description: "Secure API connection" },
        { icon: "🔄", label: "Data Sync", description: "Bi-directional data flow" },
        { icon: "✅", label: "Integrated", description: "Systems connected" },
      ],
      description: "Build custom integrations with flexible API endpoints and secure authentication."
    },
    offline: {
      title: "Offline POS Flow",
      steps: [
        { icon: "🖥️", label: "Online POS", description: "Normal operation" },
        { icon: "📶", label: "Connection Lost", description: "Offline mode activated" },
        { icon: "💾", label: "Local Storage", description: "Transactions stored locally" },
        { icon: "🔄", label: "Sync", description: "Auto-sync when reconnected" },
      ],
      description: "Continue selling even without internet connection with automatic data synchronization."
    },
    hardware: {
      title: "Hardware Connectivity Flow",
      steps: [
        { icon: "🖥️", label: "onePOS Device", description: "Windows/Android/iPad/Browser" },
        { icon: "🔌", label: "Hardware Hub", description: "USB-C/Connector" },
        { icon: "📷", label: "Scanner", description: "Barcode scanner" },
        { icon: "🖨️", label: "Printer", description: "Receipt printer" },
        { icon: "💰", label: "Cash Drawer", description: "Cash drawer" },
      ],
      description: "Connect all your POS peripherals through supported hardware connectors."
    },
  };

  const flow = flows[type];
  if (!flow) return null;

  return (
    <div className="visual-flow">
      <h3>{flow.title}</h3>
      <p className="flow-description">{flow.description}</p>
      <div className="flow-diagram">
        {flow.steps.map((step, index) => (
          <React.Fragment key={index}>
            <div className="flow-step">
              <span className="flow-icon" aria-hidden="true">{step.icon}</span>
              <div className="flow-content">
                <strong>{step.label}</strong>
                <small>{step.description}</small>
              </div>
            </div>
            {index < flow.steps.length - 1 && (
              <div className="flow-arrow" aria-hidden="true">→</div>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export default VisualFlow;