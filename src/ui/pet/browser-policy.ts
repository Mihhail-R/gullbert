// The pet document has no browser menu. Pointer events and keyboard events still
// reach the application normally; native browser shortcuts are disabled in Rust.
document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});
