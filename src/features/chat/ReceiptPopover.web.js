import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Keep receipt details out of the message layout: resizing the chat causes its
// scroll-to-end handler to move the trigger out from under a stationary pointer.
export default function ReceiptPopover({ children, details, open, onHoverChange }) {
  const anchor = useRef(null);
  const panel = useRef(null);
  const leaveTimer = useRef(null);
  const [position, setPosition] = useState(null);
  const enter = () => {
    clearTimeout(leaveTimer.current);
    onHoverChange(true);
  };
  const leave = (event) => {
    const target = event.relatedTarget;
    if (target instanceof Node && (anchor.current?.contains(target) || panel.current?.contains(target))) return;
    clearTimeout(leaveTimer.current);
    // Allow crossing the small gap between the trigger and the floating panel.
    leaveTimer.current = setTimeout(() => onHoverChange(false), 120);
  };

  useEffect(() => () => clearTimeout(leaveTimer.current), []);
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const update = () => {
      const rect = anchor.current.getBoundingClientRect();
      const margin = 8;
      const width = Math.min(320, window.innerWidth - margin * 2);
      const above = rect.top - margin * 2;
      const below = window.innerHeight - rect.bottom - margin * 2;
      const useAbove = above >= below;
      setPosition({
        position: 'fixed',
        width,
        left: Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin)),
        ...(useAbove ? { bottom: window.innerHeight - rect.top + margin } : { top: rect.bottom + margin }),
        maxHeight: Math.max(0, Math.min(320, useAbove ? above : below)),
        overflowY: 'auto',
        zIndex: 10000,
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  return (
    <div ref={anchor} onMouseEnter={enter} onMouseLeave={leave}>
      {children}
      {open && position ? createPortal(
        <div ref={panel} style={position} onMouseEnter={enter} onMouseLeave={leave}>
          {details}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
