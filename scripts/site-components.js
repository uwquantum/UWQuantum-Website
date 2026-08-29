class SiteNavbar extends HTMLElement {
  connectedCallback() {
    // display: contents makes this element invisible to layout (flexbox,
    // grid, etc. treat its children as if they were direct children of
    // .navbar), while keeping it in the DOM so CSS like ".navbar .logo"
    // still matches normally.
    this.style.display = "contents";

    // Only show the section dropdown when we're actually on the Qiskit
    // Fall Fest page — every other page gets a plain link.
    const isQiskitPage = /qiskit-fall-fest/.test(window.location.pathname);

    const qiskitNavItem = isQiskitPage
      ? `<li class="nav-dropdown">
           <a href="qiskit-fall-fest.html" class="nav-dropdown-trigger">
             Qiskit Fall Fest <span class="nav-dropdown-caret" aria-hidden="true">▾</span>
           </a>
           <ul class="nav-dropdown-menu">
             <li><a href="#about">About</a></li>
             <li><a href="#schedule">Schedule</a></li>
             <li><a href="#speakers">Speakers</a></li>
             <li><a href="#organizers">Organizers</a></li>
             <li><a href="#code-conduct">Code of Conduct</a></li>
             <li><a href="#faq">FAQ</a></li>
           </ul>
         </li>`
      : `<li><a href="qiskit-fall-fest.html">Qiskit Fall Fest</a></li>`;

    this.innerHTML = `
      <div class="logo">
        <a href="index.html" style="text-decoration: none; color: inherit">
          <span class="logo-text">Waterloo Quantum Club</span>
        </a>
      </div>
      <ul class="nav-links">
        <li><a href="index.html">Home</a></li>
        <li><a href="index.html#events">Events</a></li>
        <li><a href="game.html">Games</a></li>
        <li><a href="team.html">Team</a></li>
        <li><a href="join.html">Join</a></li>
        ${qiskitNavItem}
      </ul>
      <div class="hamburger">
        <span class="bar"></span><span class="bar"></span><span class="bar"></span>
      </div>
    `;

    // Click-to-toggle for touch devices (hover-only dropdowns don't work
    // on mobile/tablet). Desktop still gets the CSS :hover behavior for
    // free; this just adds a second way in for touch.
    if (isQiskitPage) {
      const trigger = this.querySelector(".nav-dropdown-trigger");
      const dropdown = this.querySelector(".nav-dropdown");
      trigger.addEventListener("click", (e) => {
        if (window.matchMedia("(hover: none)").matches) {
          e.preventDefault();
          dropdown.classList.toggle("open");
        }
      });
    }
  }
}

class SiteFooter extends HTMLElement {
  connectedCallback() {
    this.style.display = "contents";
    this.innerHTML = `
      <div class="footer-top">
        <p class="footer-tagline">
          A community exploring the quantum world at the University of Waterloo.
        </p>
        <ul class="footer-nav">
          <li><a href="index.html">Home</a></li>
          <li><a href="index.html#events">Events</a></li>
          <li><a href="game.html">Games</a></li>
          <li><a href="team.html">Team</a></li>
          <li><a href="join.html">Join</a></li>
          <li>
            <a href="mailto:uwquantumclub@outlook.com">uwquantumclub@outlook.com</a>
          </li>
        </ul>
      </div>
      <h2 class="footer-wordmark">Quantum&nbsp;Club</h2>
    `;
  }
}

class SiteFooterNoWordMark extends HTMLElement {
  connectedCallback() {
    this.style.display = "contents";
    this.innerHTML = `
      <div class="footer-top">
        <p class="footer-tagline">
          A community exploring the quantum world at the University of Waterloo.
        </p>
        <ul class="footer-nav">
          <li><a href="index.html">Home</a></li>
          <li><a href="index.html#events">Events</a></li>
          <li><a href="game.html">Games</a></li>
          <li><a href="team.html">Team</a></li>
          <li><a href="join.html">Join</a></li>
          <li><a href="qiskit-fall-fest.html">Qiskit Fall Fest</a></li>
          <li>
            <a href="mailto:uwquantumclub@outlook.com">uwquantumclub@outlook.com</a>
          </li>
        </ul>
      </div>
    `;
  }
}

customElements.define("site-navbar", SiteNavbar);
customElements.define("site-footer", SiteFooter);
customElements.define("site-footer-no-word-mark", SiteFooterNoWordMark);
