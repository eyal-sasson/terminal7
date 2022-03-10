import { Terminal7 } from "./terminal7.js"

class resizeObs {
    constructor(cb) {
        cb();
    }
    observe() {
    }
    disconnect() {
    }
}

export class Terminal7Mock extends Terminal7{
    constructor() {
        super({})
        this.conf = { ui: {max_tabs: 10 }}
        window.ResizeObserver = resizeObs
        document.body.innerHTML = `
<div id='t7'></div>
<div id='static-hosts'></div>
<div id='log'></div>
<div id='log-button'></div>
<div id='home-button'></div>
    <template id="gate-template">
    <div class="windows-container">
    </div>
    <div class="hidden search-box border">
      <nav class="tabbar-search">
        <button type="button" class="search-up"><i class="f7-icons">arrowtriangle_up</i></button>
        <button type="button" class="search-down"><i class="f7-icons">arrowtriangle_down</i></button>
        <!-- TODO: implment the url & file buttons
        <a href="#find-url" class="hidden">URL</a>
        <a href="#find-file" class="hidden">File</a>
        -->
        <input type="text" name="search-term">
        <button type="button" class="search-close"><i class="f7-icons">xmark</i></button>
      </nav>
    </div>
    <div class="hidden rename-box border">
      <nav class="tabbar-search">
        <button type="button" class="rename-close"><i class="f7-icons">xmark</i></button>
        <input type="text" name="new-name" id="name-input">
      </nav>
    </div>

    <nav class="tabbar">
          <button type="button" class="add-tab"><i class="f7-icons">
                  plus</i></button>
          <nav class="tabbar-names">
          </nav>
          <button type="button" class="reset"><i class="f7-icons">
                  arrow_2_circlepath</i></button>
    </nav>
    </template>
    <template id="reset-gate-template">
      <div class="reset-gate hidden modal border" >
          <p>What kind of reset whould you like?</p>
          <dl>
             <dt><button type="button" class="text-button sizes">
                     Sizes</button></dt>
              <dd>Fitting terminals and refreshing all panes' sizes</dd>
              <dt><button type="button" class="text-button channels">
                      Data Channels</button></dt>
              <dd>Replacing all data channels with fresh ones</dd>
              <dt><button type="button" class="text-button all">
                      Connection</button></dt>
              <dd>Drop the peer connection and re-connect</dd>
          </dl>
      </div>
    </template>
    <template id="divider-template">
        <div class="divider hidden">
            <img width="8" height="44" src="img/divider.png" alt="a divider">
        </div>
    </template>
`

    }
    clearTimeouts() {
    }
    open(e) {
        this.e = e
    }
}
