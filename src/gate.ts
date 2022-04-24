/*! Terminal 8 Gate
 *  This file contains the code that makes a terminal 7 gate. The gate class
 *  represents a server and it may be boarding - aka connected - or not.
 *
 *  Copyright: (c) 2020 Benny A. Daon - benny@tuzig.com
 *  License: GPLv3
 */
import { Window } from './window.js'
import { Pane } from './pane.js'
import { Session } from './session'
import { Clipboard } from '@capacitor/clipboard'
import { WSSession, PeerbookSession, SSHWebRTCSession  } from './webrtc_session'

import { Storage } from '@capacitor/storage'

const FAILED_COLOR = "red"// ashort period of time, in milli
/*
 * The gate class abstracts a host connection
 */
export class Gate {
    name: string
    e: Element
    session: Session
    watchDog: number
    activeW: Window
    username: string
    pass: string | undefined
    constructor (props) {
        // given properties
        this.id = props.id
        // this shortcut allows cells to split without knowing t7
        this.addr = props.addr
        this.user = props.user
        this.secret = props.secret
        this.store = props.store
        this.name = (!props.name)?`${this.user}@${this.addr}`:props.name
        this.username = props.username
        this.pass = props.pass
        // 
        this.windows = []
        this.boarding = false
        this.lastMsgId = 0
        // a mapping of refrence number to function called on received ack
        this.breadcrumbs = []
        this.sendStateTask  = null
        this.timeoutID = null
        this.fp = props.fp
        this.online = props.online
        this.watchDog = null
        this.verified = props.verified || false
        this.t7 = window.terminal7
        this.session = null
    }

    /*
     * Gate.open opens a gate element on the given element
     */
    open(e) {
        // create the gate element - holding the tabs, windows and tab bar
        this.e = document.createElement('div')
        this.e.className = "gate hidden"
        this.e.style.zIndex = 2
        this.e.id = `gate-${this.id}`
        e.appendChild(this.e)
        // add the tab bar
        let t = document.getElementById("gate-template")
        if (t) {
            t = t.content.cloneNode(true)
            this.openReset(t)
            t.querySelector(".add-tab").addEventListener(
                'click', _ => this.newTab())
            t.querySelector(".search-close").addEventListener('click', _ =>  {
                this.t7.logDisplay(false)
                this.activeW.activeP.exitSearch()
                this.activeW.activeP.focus()
            })
            t.querySelector(".search-up").addEventListener('click', _ =>
                this.activeW.activeP.findNext())

            t.querySelector(".search-down").addEventListener('click', _ => 
                this.activeW.activeP.findNext())

            t.querySelector(".rename-close").addEventListener('click', () => 
                this.e.querySelector(".rename-box").classList.add("hidden"))
            /* TODO: handle the bang
            let b = t.querySelector(".bang")
            b.addEventListener('click', (e) => {new window from active pane})
            */
            this.e.appendChild(t)
        }
        // Add the gates' signs to the home page
        let hostsE = document.getElementById(this.fp?"peerbook-hosts":"static-hosts")
        let b = document.createElement('button'),
            addr = this.addr && this.addr.substr(0, this.addr.indexOf(":"))
        b.className = "text-button"
        this.nameE = b
        this.nameE.innerHTML = this.name || this.addr
        this.updateNameE()
        hostsE.appendChild(b)
        b.gate = this
    }
    delete() {
        this.t7.gates.splice(this.id, 1)
        this.t7.storeGates()
        // remove the host from the home screen
        this.nameE.parentNode.parentNode.remove()
    }
    editSubmit(ev) {
        let editHost = document.getElementById("edit-host")
        this.addr = editHost.querySelector('[name="hostaddr"]').value 
        this.name = editHost.querySelector('[name="hostname"]').value
        this.username = editHost.querySelector('[name="username"]').value
        this.nameE.innerHTML = this.name || this.addr
        this.t7.storeGates()
        this.t7.clear()
    }
    /*
     * edit start the edit-host user-assitance
     */
    edit() {
        var editHost
        if (typeof(this.fp) == "string") {
            if (this.verified) {
                this.notify("Got peer from \uD83D\uDCD6, connect only")
                return
            }
            editHost = document.getElementById("edit-unverified-pbhost")
            editHost.querySelector("a").setAttribute("href",
                "https://"+ this.t7.conf.net.peerbook)
        } else {
            editHost = document.getElementById("edit-host")
            editHost.querySelector('[name="hostaddr"]').value = this.addr
            editHost.querySelector('[name="hostname"]').value = this.name
            editHost.querySelector('[name="username"]').value = this.username
        }
        editHost.gate = this
        editHost.classList.remove("hidden")
    }
    focus() {
        this.t7.logDisplay(false)
        // hide the current focused gate
        document.getElementById("home-button").classList.remove("on")
        document.querySelectorAll(".pane-buttons").forEach(
            e => e.classList.remove("off"))
        let activeG = this.t7.activeG
        if (activeG) {
            activeG.e.classList.add("hidden")
        }
        this.t7.activeG = this
        this.e.classList.remove("hidden")
        this.e.querySelectorAll(".window").forEach(w => w.classList.add("hidden"))
        this.activeW.focus()
        this.storeState()
    }
    // stops all communication 
    stopBoarding() {
        this.boarding = false
    }
    setIndicatorColor(color) {
            this.e.querySelector(".tabbar-names").style.setProperty(
                "--indicator-color", color)
    }
    clearWatchdog() {
        if (this.watchDog != null) {
            window.clearTimeout(this.watchDog)
            this.watchDog = null
        }
    }
    /*
     * onSessionState(state) is called when the connection
     * state changes.
     */
    onSessionState(state: RTState) {
        this.t7.log(`updating ${this.name} state to ${state}`)
        this.notify("State: " + state)
        if (state == "connected") {
            this.t7.logDisplay(false)
            this.clearWatchdog()
            this.setIndicatorColor("unset")
            var m = this.t7.e.querySelector(".disconnect")
            if (m != null)
                m.remove()
            // show help for first timer
            Storage.get({key: "first_gate"}).then(v => {
                if (v.value != "1") {
                    this.t7.run(this.t7.toggleHelp, 1000)
                    Storage.set({key: "first_gate", value: "1"}) 
                }
            })
            this.session.getPayload().then(layout => this.setLayout(layout))
        } else if (state == "disconnected") {
            // TODO: add warn class
            this.lastDisconnect = Date.now()
            // TODO: start the rain
            this.setIndicatorColor(FAILED_COLOR)
        } else if (state == "unauthorized") {
            this.clearWatchdog()
            this.stopBoarding()
            this.copyFingerprint()
        } else if (state == "wrong password") {
            this.clearWatchdog()
            this.stopBoarding()
            this.session = null
            this.connect()
        } else if ((state != "new") && (state != "connecting") && this.boarding) {
            // handle connection failures
            let now = Date.now()
            if (now - this.lastDisconnect > 100) {
                this.t7.onDisconnect(this)
                this.stopBoarding()
            } else
                this.t7.log("Ignoring a peer this.t7.cells.forEach(c => event after disconnect")
        }
    }
    /*
     * connect connects to the gate
     */
    async connect() {
        // do nothing when the network is down
        if (!this.t7.netStatus || !this.t7.netStatus.connected)
            return
        // if we're already boarding, just focus
        if (this.boarding) {
            console.log("already boarding")
            if (!this.windows || (this.windows.length == 0))
                this.activeW = this.addWindow("", true)
            this.focus()
            return
        }
        this.boarding = true
        this.notify("Initiating connection")
        // start the connection watchdog
        if (this.watchDog != null)
            window.clearTimeout(this.watchDog)
        this.watchDog = this.t7.run(_ => {
            console.log("WATCHDOG stops the gate connecting")
            this.watchDog = null
            this.stopBoarding()
            this.t7.onDisconnect(this)
        }, this.t7.conf.net.timeout)
        
        if (this.session == null) {
            if (typeof this.fp == "string") {
                this.session = new PeerbookSession(this.fp)
            }
            else {
                let pass = this.pass
                // this.session = new WSSession(this.addr, this.user)
                // TODO add the port
                if (!pass) {
                    window.clearTimeout(this.watchDog)
                    this.watchDog = null
                    this.askPass()
                    return
                }
                this.completeConnect(pass)
            }
        }
    }

    notify(message) {    
        this.t7.notify(`${this.name}: ${message}`)
    }
    /*
     * returns an array of panes
     */
    panes() {
        var r = []
        this.t7.cells.forEach(c => {
            if (c instanceof Pane && (c.gate == this))
                r.push(c)
        })
        return r
    }
    // reset reset's a gate connection by disengaging and reconnecting
    reset() {
        if (this.watchDog != null) {
            window.clearTimeout(this.watchDog)
            this.watchDog = null
        }
        this.disengage().then(() => this.t7.run(() => this.connect(), 100))
    }
    loseState () {
        let e = document.getElementById("lose-state-template")
        e = e.content.cloneNode(true)
        e.querySelector(".continue").addEventListener('click', evt => {
            evt.target.closest(".modal").classList.toggle("hidden")
            this.clear()
            this.activeW = this.addWindow("", true)
            this.focus()
        })
        e.querySelector(".close").addEventListener('click', evt => {
            evt.target.closest(".modal").classList.toggle("hidden")
            this.clear()
            this.t7.goHome()
        })
        this.e.appendChild(e)
    }
    setLayout(state: object) {
        const winLen = this.windows.length
        // got an empty state
        if ((state == null) || !(state.windows instanceof Array) || (state.windows.length == 0)) {
            // create the first window and pane
            this.t7.log("Fresh state, creating the first pane")
            if (winLen > 0)
                this.loseState()
            else
                this.activeW = this.addWindow("", true)
        } else if (winLen > 0) {
            // TODO: validate the current layout is like the state
            this.t7.log("Restoring with marker, opening channel")
            this.panes().forEach(p => {
                if (p.d)
                    p.openChannel({id: p.d.id})
            })
        } else {
            this.t7.log("Setting layout: ", state)
            this.clear()
            state.windows.forEach(w =>  {
                let win = this.addWindow(w.name)
                if (w.active) 
                    this.activeW = win
                win.restoreLayout(w.layout)
            })
        }

        if (!this.activeW)
            this.activeW = this.windows[0]
        this.focus()
    }
    /*
     * Adds a window, opens it and returns it
     */
    addWindow(name, createPane) {
        this.t7.log(`adding Window: ${name}`)
        let id = this.windows.length
        let w = new Window({name:name, gate: this, id: id})
        this.windows.push(w)
        if (this.windows.length >= this.t7.conf.ui.max_tabs)
            this.e.querySelector(".add-tab").classList.add("off")
        w.open(this.e.querySelector(".windows-container"))
        if (createPane) {
            let paneProps = {sx: 1.0, sy: 1.0,
                             xoff: 0, yoff: 0,
                             w: w,
                             gate: this},
                layout = w.addLayout("TBD", paneProps)
            w.activeP = layout.addPane(paneProps)
        }
        return w
    }
    /*
     * clear clears the gates memory and display
     */
    clear() {
        console.log("Clearing gate")
        this.e.querySelector(".tabbar-names").innerHTML = ""
        this.e.querySelectorAll(".window").forEach(e => e.remove())
        if (this.activeW && this.activeW.activeP.zoomed)
            this.activeW.activeP.toggleZoom()
        this.windows = []
        this.breadcrumbs = []
        this.msgs = {}
        this.marker = -1
    }
    /*
     * dump dumps the host to a state object
     * */
    dump() {
        var wins = []
        this.windows.forEach((w, i) => {
            let win = {
                name: w.name,
                layout: w.dump()
            }
            if (w == this.activeW)
                win.active = true
            wins.push(win)
        })
        return { windows: wins }
    }
    storeState() {
        const dump = this.dump()
        var lastState = {windows: dump.windows}

        if (this.fp)
            lastState.fp = this.fp
        lastState.name = this.name
        Storage.set({key: "last_state",
                     value: JSON.stringify(lastState)})
    }

    sendState() {
        if (this.sendStateTask != null)
            return

        this.storeState()
        // send the state only when all panes have a channel
        if (this.session && (this.panes().every(p => p.d != null)))
           this.sendStateTask = setTimeout(() => {
               this.sendStateTask = null
               this.session.setPayload(this.dump()).then(() => {
                    if ((this.windows.length == 0) && (this.pc)) {
                        console.log("Closing gate after updating to empty state")
                        this.disengage()
                        this.stopBoarding()
                    }
               })
            }, 100)
    }
    onPaneConnected(pane) {
        // hide notifications
        this.t7.clear()
        //enable search
        document.querySelectorAll(".pane-buttons").forEach(
            e => e.classList.remove("off"))
    }
    goBack() {
        var w = this.breadcrumbs.pop()
        this.breadcrumbs = this.breadcrumbs.filter(x => x != w)
        if (this.windows.length == 0) {
            this.clear()
            this.t7.goHome()
        }
        else
            if (this.breadcrumbs.length > 0)
                this.breadcrumbs.pop().focus()
            else
                this.windows[0].focus()
    }
    showResetHost() {
        let e = document.getElementById("reset-host"),
            addr = this.addr.substr(0, this.addr.indexOf(":"))

        document.getElementById("rh-address").innerHTML = addr
        document.getElementById("rh-name").innerHTML = this.name
        e.classList.remove("hidden")
    }
    fit() {
        this.windows.forEach(w => w.fit())
    }
    /*
     * disengage orderly disengages from the gate's connection.
     * It first sends a mark request and on it's ack store the restore marker
     * and closes the peer connection.
     */
    disengage() {
        return new Promise(resolve => {
            this.t7.log(`disengaging. boarding is ${this.boarding}`)
            if (!this.boarding || !this.session) {
                resolve()
                return
            }
            this.session.disconnect().then(resolve)
            this.boarding = false
        })
    }
    closeActivePane() {
        this.activeW.activeP.close()
    }
    newTab() {
        if (this.windows.length < this.t7.conf.ui.max_tabs) {
            let w = this.addWindow("", true)
            this.breadcrumbs.push(w)
            w.focus()
        }
    }
    openReset(t) {
        //TODO: clone this from a template
        let e = document.getElementById("reset-gate-template")
        e = e.content.cloneNode(true)
        t.querySelector(".reset").addEventListener('click', _ => {
            this.e.querySelector(".reset-gate").classList.toggle("hidden")
        })
        e.querySelector(".sizes").addEventListener('click', _ => {
            this.notify("Resetting sizes")
            this.e.querySelector(".reset-gate").classList.toggle("hidden")
            this.panes().forEach(p => {
                if (!p.fit())
                    this.sendSize(p)
            })
        })
        e.querySelector(".channels").addEventListener('click', _ => {
            this.notify("Resetting data channels")
            this.e.querySelector(".reset-gate").classList.toggle("hidden")
            this.marker = 0
            this.panes().forEach(p => {
                p.d.close()
                p.openChannel({id: p.d.id})
            })
        })
        e.querySelector(".all").addEventListener('click', _ => {
            this.e.querySelector(".reset-gate").classList.toggle("hidden")
            this.reset()
        })
        this.e.appendChild(e)
    }
    updateNameE() {
        this.nameE.innerHTML = this.name
        if (!this.fp) {
            // there's nothing more to update for static hosts
            return
        }
        if (this.verified)
            this.nameE.classList.remove("unverified")
        else
            this.nameE.classList.add("unverified")
        if (this.online)
            this.nameE.classList.remove("offline")
        else
            this.nameE.classList.add("offline")
    }
    copyFingerprint() {
        let ct = document.getElementById("copy-fingerprint"),
            addr = this.addr.substr(0, this.addr.indexOf(":"))
        this.t7.getFingerprint().then(fp =>
                ct.querySelector('[name="fingerprint"]').value = fp)
        document.getElementById("ct-address").innerHTML = addr
        document.getElementById("ct-name").innerHTML = this.name
        ct.classList.remove("hidden")
        ct.querySelector(".copy").addEventListener('click', ev => {
            ct.classList.add("hidden")
            Clipboard.write(
                {string: ct.querySelector('[name="fingerprint"]').value})
            this.t7.notify("Fingerprint copied to the clipboard")
        })
        ct.querySelector(".close").addEventListener('click',  ev =>  {
            ct.classList.add("hidden")
        })
    }
    askPass() {
        const hideModal = evt => evt.target.closest(".modal").classList.toggle("hidden")
        const e = document.getElementById("askpass")

        if (!e) {
            // for debug
            this.completeConnect("BADWOLF")
            return
        }
        e.querySelector("h1").innerText = `${this.username}@${this.name}`
        e.classList.remove("hidden")
        this.t7.logDisplay(false)
        e.querySelector("form").onsubmit = evt => {
            hideModal(evt)
            const pass = evt.target.querySelector('[name="pass"]').value
            this.completeConnect(pass)
            evt.stopPropagation()
            evt.preventDefault()
        }
        e.querySelector(".close").onclick = evt => {
            hideModal(evt)
            this.stopBoarding()
        }
        e.querySelector('[name="pass"]').focus()
    }
    completeConnect(pass: string): void {
        // TODO: be smart about choosing comm method
        // this.session = new SSHSession(this.addr, this.username, pass)
        this.session = new SSHWebRTCSession(this.addr, this.username, pass)
        this.session.onStateChange = state => this.onSessionState(state)
        this.session.onPayloadUpdate = layout => {
            this.notify("TBD: update new layout")
            this.t7.log("TBD: update layout", layout)
        }
        console.log("opening session")
        // TODO: use the generated fingerprint and not t7's global fingerprint
        // await this.t7.getFingerprint()
        // this.t7.run(() => this.session.connect(), 500)
        this.session.connect()
    }
}
