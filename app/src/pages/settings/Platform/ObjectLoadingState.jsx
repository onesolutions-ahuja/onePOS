import React from "react";

export default function ObjectLoadingState({
  message = "Loading...",
}) {
  return (
    <div className="object-loading-state" role="status">
      {message}
    </div>
  );
}
