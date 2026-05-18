
class DeckStage extends HTMLElement {
  connectedCallback() {
    var ss = this.querySelectorAll('deck-slide');
    ss.forEach(function(s,i){s.classList.toggle('is-active',i===0)});
  }
}
customElements.define('deck-stage', DeckStage);
class DeckSlide extends HTMLElement {}
customElements.define('deck-slide', DeckSlide);
