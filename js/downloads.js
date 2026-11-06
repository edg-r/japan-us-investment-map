/* Research downloads stay independent of map rendering. */
(function () {
  const notes = document.getElementById("notes");
  const tabs = [...notes.querySelectorAll('[role="tab"]')];
  let opener = null;
  function selectSection(tab) {
    tabs.forEach((item) => {
      const active = item === tab;
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
      document.getElementById(item.getAttribute("aria-controls")).hidden = !active;
    });
    notes.scrollTop = 0;
  }
  for (const id of ["about-open", "about-data", "download-data"]) {
    document.getElementById(id).addEventListener("click", (event) => {
      event.preventDefault();
      opener = event.currentTarget;
      selectSection(document.getElementById(id === "download-data" ? "downloads-tab" : "about-tab"));
      notes.showModal();
      document.getElementById("notes-close").focus({ preventScroll: true });
    });
  }
  tabs.forEach((tab) => tab.addEventListener("click", () => selectSection(tab)));
  notes.querySelector('[role="tablist"]').addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 :
      (tabs.indexOf(document.activeElement) + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    selectSection(tabs[index]);
    tabs[index].focus();
  });
  document.getElementById("notes-close").addEventListener("click", () => notes.close());
  // Only a click that starts and ends outside the dialog is a backdrop click.
  const outside = (event) => {
    const b = notes.getBoundingClientRect();
    return event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom;
  };
  let backdropDown = false;
  notes.addEventListener("pointerdown", (event) => { backdropDown = event.target === notes && outside(event); });
  notes.addEventListener("click", (event) => {
    if (backdropDown && event.target === notes && outside(event)) notes.close();
    backdropDown = false;
  });
  notes.addEventListener("close", () => {
    // A queued close event can arrive after an immediate reopen. In that case,
    // preserve the new opener and the new dialog's focus.
    if (notes.open) return;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  });
  document.getElementById("copy-citation").addEventListener("click", async () => {
    const citation = document.getElementById("data-citation");
    const status = document.getElementById("citation-status");
    try {
      await navigator.clipboard.writeText(citation.textContent.trim());
      status.textContent = "Citation copied.";
    } catch (error) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(citation);
      selection.removeAllRanges();
      selection.addRange(range);
      status.textContent = document.execCommand("copy") ? "Citation copied." : "Citation selected. Press Ctrl+C or ⌘C to copy.";
    }
  });
  if (location.protocol !== "file:") {
    fetch("data/manifest.json").then((response) => {
      if (!response.ok) throw new Error("Download manifest unavailable");
      return response.json();
    }).then((files) => {
      document.querySelectorAll(".download-list a").forEach((link) => {
        const file = files[link.getAttribute("href").split("/").pop()];
        if (!file) return;
        const kb = file.bytes / 1024;
        link.querySelector(".file-size").textContent = (kb < 10 ? kb.toFixed(1) : Math.round(kb)) + " KB";
        link.title = file.bytes.toLocaleString("en-US") + " bytes";
      });
    }).catch(() => { /* Static size labels also work when opened directly. */ });
  }
})();
