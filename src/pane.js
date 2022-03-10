/*! Terminal 7 Pane - a class that colds a pane - a terminal emulation 
 * connected over a data channel to a remote interactive process
 *
 *  Copyright: (c) 2021 Benny A. Daon - benny@tuzig.com
 *  License: GPLv3
 */
import { Terminal } from 'xterm'
import { Clipboard } from '@capacitor/clipboard'
import { Storage } from '@capacitor/storage'
import { FitAddon } from 'xterm-addon-fit'
import { SearchAddon } from 'xterm-addon-search'
import { Cell } from './cell.js'
import { fileRegex, urlRegex } from './utils.js'

import XtermWebfont from 'xterm-webfont'

const  REGEX_SEARCH        = false,
      COPYMODE_BORDER_COLOR = "#F952F9",
        FOCUSED_BORDER_COLOR = "#F4DB53",
       SEARCH_OPTS = {
            regex: REGEX_SEARCH,
            wholeWord: false,
            incremental: false,
            caseSensitive: true}


export class Pane extends Cell {
    constructor(props) {
        props.className = "pane"
        super(props)
        this.catchFingers()
        this.state = "init"
        this.d = null
        this.active = false
        this.webexecID = props.webexec_id || null
        this.fontSize = props.fontSize || 12
        this.theme = props.theme || this.t7.conf.theme
        this.copyMode = false
        this.cmAtEnd = null
        this.cmCursor = null
        this.cmMarking = false
        this.dividers = []
        this.flashTimer = null
        this.aLeader = false
    }

    /*
     * Pane.write writes data to the terminal
     */
    write(data) {
        this.t.write(data)
    }
                
    /*
     * Pane.openTerminal opens an xtermjs terminal on our element
     */
    openTerminal(parent) {
        var con = document.createElement("div")
        this.t = new Terminal({
            convertEol: false,
            fontFamily: "FiraCode",
            fontSize: this.fontSize,
            rendererType: (Capacitor.getPlatform()=="ios")?"dom":"canvas",
            theme: this.theme,
            rows:24,
            cols:80
        })
        this.fitAddon = new FitAddon()
        this.searchAddon = new SearchAddon()

        // there's a container div we need to get xtermjs to fit properly
        this.e.appendChild(con)
        con.style.height = "100%"
        con.style.width = "100%"
        this.t.loadAddon(new XtermWebfont())
        // the canvas gets the touch event and the nadler needs to get back here
        this.t.loadAddon(this.fitAddon)
        this.t.loadAddon(this.searchAddon)
        this.createDividers()
        this.t.onSelectionChange(() => this.selectionChanged())
        this.t.loadWebfontAndOpen(con).then(_ => {
            this.fit(pane => { if (pane != null) pane.openDC(parent) })
            this.t.textarea.tabIndex = -1
            this.t.attachCustomKeyEventHandler(ev => {
                var toDo = true
                var meta = false
                // ctrl c is a special case 
                if (ev.ctrlKey && (ev.key == "c") && (this.d != null)) {
                    this.d.send(String.fromCharCode(3))
                    toDo = false
                }
                if (ev.ctrlKey && (ev.key == this.t7.conf.ui.leader)) {
                    this.aLeader = !this.aLeader
                    toDo = !this.aLeader
                }
                else if (ev.metaKey && (ev.key != "Shift") && (ev.key != "Meta") ||
                    this.aLeader && (ev.key != this.t7.conf.ui.leader) 
                                 && (ev.key != 'Control')) {
                    // ensure help won't pop
                    this.t7.metaPressStart = Number.MAX_VALUE
                    toDo = this.handleMetaKey(ev)
                    this.aLeader = false
                }
                else if (this.copyMode) {
                    if  (ev.type == "keydown")
                        this.handleCMKey(ev.key)
                    toDo = false
                }
                if (!toDo) {
                    ev.stopPropagation()
                    ev.preventDefault()
                }
                return toDo
            })
            this.t.onData(d =>  {
                if (this.d == null) {
                    this.gate.notify("Peer is disconnected")
                    return
                }
                if (this.d.readyState != "open") {
                    this.gate.notify(`data channel is ${this.d.readyState}`)
                    return
                }
                this.d.send(d)
            })
            const resizeObserver = new ResizeObserver(_ => this.fit())
            resizeObserver.observe(this.e);
        })
        return this.t
    }
    setTheme(theme) {
        this.t.setOption("theme", theme)
    }
    /*
     * Pane.scale is used to change the pane's font size
     */
    scale(by) {
        this.fontSize += by
        if (this.fontSize < 6) this.fontSize = 6
        else if (this.fontSize > 30) this.fontSize = 30
        this.t.setOption('fontSize', this.fontSize)
        this.fit()
    }

    // fit a pane to the display area. If it was resized, the server is updated.
    // returns true is size was changed
    fit(cb) {
        var oldr = this.t.rows,
            oldc = this.t.cols,
            ret = false

        // there's no point in fitting when in the middle of a restore
        //  it happens in the eend anyway
        if (this.gate.marker != -1) {
            return
        }
        try {
            this.fitAddon.fit()
        } catch {
            if (this.retries < this.t7.conf.retries) {
                this.retries++
                this.t7.run(this.fit, 20*this.retries)
            }
            else {
                this.t7.log(`fit failed ${this.retries} times. giving up`)
                if (cb instanceof Function) cb(null)
            }
            return
        }
        this.refreshDividers()
        if (this.t.rows != oldr || this.t.cols != oldc) {
            this.gate.sendState()
            this.gate.sendSize(this)
            ret = true
        }
        if (cb instanceof Function) cb(this)
        return ret
    }
    /*
     * Pane.focus focuses the UI on this pane
     */
    focus() {
        super.focus()
        if (this.t !== undefined)
            this.t7.run(_ => this.t.focus(), 10)
        else 
            this.t7.log("can't focus, this.t is undefined")
    }
    /*
     * Splitting the pane, receivees a dir-  either "topbottom" or "rightleft"
     * and the relative size (0-1) of the area left for us.
     * Returns the new pane.
     */
    split(dir, s) {
        var sx, sy, xoff, yoff, l
        // if the current dir is `TBD` we can swing it our way
        if (typeof s == "undefined")
            s = 0.5
        if ((this.layout.dir == "TBD") || (this.layout.cells.length == 1))
            this.layout.dir = dir
        // if we need to create a new layout do it and add us and new pane as cells
        if (this.layout.dir != dir)
            l = this.w.addLayout(dir, this)
        else 
            l = this.layout

        // update the dimensions & position
        if (dir == "rightleft") {
            sy = this.sy * (1 - s)
            sx = this.sx
            xoff = this.xoff
            this.sy -= sy
            yoff = this.yoff + this.sy
        }
        else  {
            sy = this.sy
            sx = this.sx * (1 - s)
            yoff = this.yoff
            this.sx -= sx
            xoff = this.xoff + this.sx
        }
        this.fit()

        // add the new pane
        let p = l.addPane({sx: sx, sy: sy, 
                       xoff: xoff, yoff: yoff,
                       parent: this})
        p.focus()
        return p

    }
    openDC(parent) {
        var tSize = this.t.rows+'x'+this.t.cols,
            label = ""
        this.buffer = []

        // stop listening to old channel events
        if (this.d) {
            this.d.onclose = undefined
            this.d.onopen = undefined
            this.d.onmessage = undefined
        }

        if (!this.webexecID) {
            this.updateID = null
            var msgID = this.gate.sendCTRLMsg({
                type: "add_pane", 
                args: { 
                    command: [this.t7.conf.exec.shell],
                    rows: this.t.rows,
                    cols: this.t.cols,
                    parent: parent || 0
                }
            })
            this.t7.pendingPanes[msgID] = this
        } else {
            this.updateID = null
            var msgID = this.gate.sendCTRLMsg({
                type: "reconnect_pane", 
                args: { 
                    id: this.webexecID
                }
            })
            this.t7.pendingPanes[msgID] = this
        }
    }
    flashIndicator () {
        if (this.flashTimer == null) {
            let  flashTime = this.t7.conf.indicators && this.t7.conf.indicators.flash
                             || 88
            this.gate.setIndicatorColor("#373702")
            this.flashTimer = this.t7.run(_ => {
                this.flashTimer = null
                this.gate.setIndicatorColor("unset")
            }, flashTime) 
        }
    }
    // called when a message is received from the server
    onMessage (m) {
        this.flashIndicator()
        if (this.state == "opened") {
            var enc = new TextDecoder("utf-8"),
                msg = enc.decode(m.data)
            this.state = "connected"
            this.webexecID = parseInt(msg.split(",")[0])
            if (isNaN(this.webexecID)) {
                this.gate.notify(msg, true)
                this.t7.log(`got an error on pane connect: ${msg}`)
                this.close()
            } else
                this.gate.onPaneConnected(this)
        }
        else if (this.state == "connected") {
            this.write(new Uint8Array(m.data))
        }
        else
            this.gate.notify(`${this.state} & dropping a message: ${m.data}`)
    }
    toggleZoom() {
        super.toggleZoom()
        this.fit()
    }
    toggleSearch(searchDown) {
        const se = this.gate.e.querySelector(".search-box")
        if (se.classList.contains("hidden"))
            this.showSearch()
        else {
            this.hideSearch()
            this.focus()
        }
    }

    showSearch(searchDown) {
        // show the search field
        this.searchDown = searchDown || false
        const se = this.gate.e.querySelector(".search-box")
        se.classList.remove("hidden")
        document.getElementById("search-button").classList.add("on")
        // TODO: restore regex search
        let up = se.querySelector(".search-up"),
            down = se.querySelector(".search-down"),
            i = se.querySelector("input[name='search-term']")
        if (searchDown) {
            up.classList.add("hidden")
            down.classList.remove("hidden")
        } else {
            up.classList.remove("hidden")
            down.classList.add("hidden")
        }
        if (REGEX_SEARCH) {
            i.setAttribute("placeholder", "regex here")
            u.classList.remove("hidden")
            f.classList.remove("hidden")
            u.onclick = ev => {
                ev.preventDefault()
                ev.stopPropagation()
                this.focus()
                i.value = this.searchTerm = urlRegex
            }
            // TODO: findPrevious does not work well
            f.onclick = _ => this.searchAddon.findPrevious(fileRegex, SEARCH_OPTS)
        } else 
            i.setAttribute("placeholder", "search string here")
        if (this.searchTerm)
            i.value = this.searchTerm

        i.onkeydown = ev => {
            if (ev.keyCode == 13) {
                this.findNext(i.value)
                this.hideSearch()
                this.t7.run(_ => this.t.focus(), 10)
            }
        }
        i.focus()
    }
    enterCopyMode(marking) {
        if (marking)
            this.cmMarking = true
        if (!this.copyMode) {
            this.copyMode = true
            this.cmInitCursor()
            this.cmAtEnd = null
            if (this.zoomed)
                this.t7.zoomedE.children[0].style.borderColor = COPYMODE_BORDER_COLOR
            else
                this.e.style.borderColor = COPYMODE_BORDER_COLOR
            Storage.get({key: "first_copymode"}).then(v => {
                if (v.value != "1") {
                    var e = document.getElementById("help-copymode")
                    e.classList.remove("hidden")
                    Storage.set({key: "first_copymode", value: "1"})
                }
            })
        }
    }
    exitCopyMode() {
        if (this.copyMode) {
            this.copyMode = false
            this.e.style.borderColor = FOCUSED_BORDER_COLOR
            this.t.clearSelection()
            this.t.scrollToBottom()
            if (this.zoomed)
                this.t7.zoomedE.children[0].style.borderColor = FOCUSED_BORDER_COLOR
            else
                this.e.style.borderColor = FOCUSED_BORDER_COLOR
            this.focus()
        }
    }
    hideSearch() {
        const se = this.gate.e.querySelector(".search-box")
        se.classList.add("hidden")
        document.getElementById("search-button").classList.remove("on")
    }
    exitSearch() {
        this.hideSearch();
        this.exitCopyMode();
    }
    handleMetaKey(ev) {
        var f = null
        this.t7.log(`Handling meta key ${ev.key}`)
        switch (ev.key) {
        case "c":
            if (this.t.hasSelection()) 
                this.copySelection()
            break
        case "z":
            f = () => this.toggleZoom()
            break
        case ",":
            f = () => this.w.rename()
            break
        case "d":
            f = () => this.close()
            break
        case "0":
            f = () => this.scale(12 - this.fontSize)
            break
        case "=":
                f = () => this.scale(1)
            break
        case "-":
            f = () => this.scale(-1)
            break
        case "5":
            f = () => this.split("topbottom")
            break
        case "'":
            f = () => this.split("rightleft")
            break
        case "[":
   
            f = () => this.enterCopyMode()
            break
        case "f":
            f = () => this.showSearch()
            break
        // next two keys are on the gate level
        case "t":
            f = () => this.gate.newTab()
            break
        case "r":
            f = () => this.gate.disengage(_ => this.gate.connect())
            break
        // this key is at terminal level
        case "l":
            f = () => this.t7.logDisplay()
            break
        case "ArrowLeft":
            f = () => this.w.moveFocus("left")
            break
        case "ArrowRight":
            f = () => this.w.moveFocus("right")
            break
        case "ArrowUp":
            f = () => this.w.moveFocus("up")
            break
        case "ArrowDown":
            f = () => this.w.moveFocus("down")
            break
        case "`":
            f = () => this.t7.dumpLog()
            break
        }

        if (f != null) {
            f()
            ev.preventDefault()
            ev.stopPropagation()
            return false
        }
        return true
    }
    findNext(searchTerm) {
        if (searchTerm != undefined) {
            this.cmAtEnd = null
            this.t.setOption("selectionStyle", "plain")
            this.searchTerm = searchTerm
        }

        if (this.searchTerm != undefined) {
            if (this.searchDown)
                if (!this.searchAddon.findNext(this.searchTerm, SEARCH_OPTS))
                    this.gate.notify(`Couldn't find "${this.searchTerm}"`)
                else 
                    this.enterCopyMode(true)
            if (!this.searchDown)
                if (!this.searchAddon.findPrevious(this.searchTerm, SEARCH_OPTS))
                    this.gate.notify(`Couldn't find "${this.searchTerm}"`)
                else 
                    this.enterCopyMode(true)
        }
    }
    /*
     * createDividers creates a top and left educationsl dividers.
     * The dividers are here because they're elegant and they let the user know
     * he can move the borders
     * */
    createDividers() {
        // create the dividers
        var t = document.getElementById("divider-template")
        if (t) {
            var d = [t.content.cloneNode(true),
                     t.content.cloneNode(true)]
            d.forEach((e, i) => {
                this.w.e.prepend(e)
                e = this.w.e.children[0]
                e.classList.add((i==0)?"left-divider":"top-divider")
                e.pane = this
                this.dividers.push(e)
            })
        }
    }
    /*
     * refreshDividerrs rrepositions the dividers after the pane has been
     * moved or resized
     */
    refreshDividers() {
        var W = this.w.e.offsetWidth,
            H = this.w.e.offsetHeight,
            d = this.dividers[0]
        if (this.xoff > 0.001 & this.sy * H > 50) {
            // refresh left divider position
            d.style.left = `${this.xoff * W - 4 - 20 }px`
            d.style.top = `${(this.yoff + this.sy/2)* H - 22 - 40}px`
            d.classList.remove("hidden")
        } else
            d.classList.add("hidden")
        d = this.dividers[1]
        if (this.yoff > 0.001 & this.sx * W > 50) {
            // refresh top divider position
            d.style.top = `${this.yoff * H - 25 - 20 }px`
            d.style.left = `${(this.xoff + this.sx/2)* W - 22 - 40}px`
            d.classList.remove("hidden")
        } else
            d.classList.add("hidden")
    }
    close() {
        if (this.d)
            this.d.onclose = undefined
        this.dividers.forEach(d => d.classList.add("hidden"))
        super.close()
    }
    dump() {
        var cell = {
            sx: this.sx,
            sy: this.sy,
            xoff: this.xoff,
            yoff: this.yoff,
            fontSize: this.fontSize,
            webexec_id: this.webexecID,
        }
        if (this.w.activeP && this.webexecID == this.w.activeP.webexecID)
            cell.active = true
        if (this.zoomed)
            cell.zoomed = true
        return cell
    }
    // listening for terminal selection changes
    selectionChanged() {
        const selection = this.t.getSelectionPosition()
        if (selection != null) {
            this.copySelection()
            this.t.clearSelection()
        }
    }
    copySelection() {
        let i,
            ret = "",
            lines = this.t.getSelection().split('\n')
        for (i = 0; i < lines.length; i++)
            ret += lines[i].trimEnd()+'\n'
    
        return Clipboard.write({string: ret})
    }
    handleCMKey(key) {
        var x, y, newX, newY,
            selection = this.t.getSelectionPosition()
        // chose the x & y we're going to change
        if ((!this.cmMarking) || (selection == null)) {
            this.cmMarking = false
            if (!this.cmCursor)
                this.cmInitCursor()
            x = this.cmCursor.x
            y =  this.cmCursor.y; 
            selection = {
                startColumn: x,
                endColumn: x,
                startRow: y,
                endRow: y
            }
        }
        else if (this.cmAtEnd) {
            x = selection.endColumn
            y = selection.endRow; 
        }
        else {
            x = selection.startColumn
            y = selection.startRow; 
        }
        newX = x
        newY = y
        switch(key) {
            // space is used to toggle the marking state
            case ' ':
                if (!this.cmMarking) {
                    // entering marking mode, start the selection on the cursor
                    // with unknown direction
                    this.cmAtEnd = null
                } else {
                    this.cmInitCursor()
                }
                this.cmMarking = !this.cmMarking
                console.log("setting marking:", this.cmMarking)
                this.cmSelectionUpdate(selection)
                break
            case "Enter":
                if (this.t.hasSelection())
                    this.copySlection().then(this.exitCopyMode())
                else
                    this.exitCopyMode();
                break
            case '/':
                this.showSearch(true)
                break
            case '?':
                this.showSearch()
                break
            case 'Escape':
            case 'q':
                this.exitCopyMode()
                break
            case 'n':
                this.findNext()
                break
            case 'ArrowLeft':
            case 'h':
                if (x > 0) 
                    newX = x - 1
                if (this.cmAtEnd === null)
                    this.cmAtEnd = false
                break
            case 'ArrowRight':
            case 'l':
                if (x < this.t.cols - 2)
                    newX = x + 1
                if (this.cmAtEnd === null)
                    this.cmAtEnd = true
                break
            case 'ArrowDown':
            case 'j':
                if (y < this.t.buffer.active.baseY + this.t.rows)
                    newY = y + 1
                if (this.cmAtEnd === null)
                    this.cmAtEnd = true
                break
            case 'ArrowUp':
            case 'k':
                if (y > 0)
                    newY = y - 1
                if (this.cmAtEnd === null)
                    this.cmAtEnd = false
                break
        }
        if ((newY != y) || (newX != x)) {
            if (!this.cmMarking) {
                this.cmCursor.x = newX
                this.cmCursor.y = newY; 
            }
            else if (this.cmAtEnd) {
                if ((newY < selection.startRow) || 
                   ((newY == selection.startRow)
                    && (newX < selection.startColumn))) {
                    this.cmAtEnd = false
                    selection.endRow = selection.startRow
                    selection.endColumn = selection.startColumn
                    selection.startRow = newY
                    selection.startColumn = newX
                } else {
                    selection.endColumn = newX
                    selection.endRow = newY
                }
            }
            else {
                if ((newY > selection.endRow) ||
                    ((newY == selection.endRow)
                     && (newX > selection.endColumn))) {
                    this.cmAtEnd = true
                    selection.endRow = newY
                    selection.endColumn = newX
                } else {
                    selection.startColumn = newX
                    selection.startRow = newY
                }
            }
            this.cmSelectionUpdate(selection)
            if ((newY >= this.t.buffer.active.viewportY + this.t.rows) ||
                (newY < this.t.buffer.active.viewportY)) {
                let scroll = newY - this.t.buffer.active.viewportY
                this.t.scrollLines(scroll, true)
                console.log(scroll, this.t.buffer.active.viewportY, this.t.buffer.active.baseY)
            }
        }
    }
    cmInitCursor() {
        var selection = this.t.getSelectionPosition()
        if (selection) {
            this.cmCursor = {
                x: this.cmAtEnd?selection.endColumn:selection.startColumn,
                y: this.cmAtEnd?selection.endRow:selection.startRow
            }
            return
        }
        const buffer = this.t.buffer.active
        this.cmCursor = {x: buffer.cursorX,
                         y: buffer.cursorY + buffer.viewportY}
    }
    cmSelectionUpdate(selection) {
        if (this.cmAtEnd == null)
            this.t.setOption("selectionStyle", "plain")
        else
            this.t.setOption("selectionStyle", this.cmAtEnd?"mark-end":"mark-start")
        // maybe it's a cursor
        if (!this.cmMarking) {
            console.log("using selection to draw a cursor at", this.cmCursor)
            this.t.select(this.cmCursor.x, this.cmCursor.y, 1)
            return
        }
        if (!this.cmAtEnd) {
            if (selection.startRow > selection.endRow) {
                selection.endRow = selection.startRow
            }
            if (selection.endRow === selection.startRow) {
                if (selection.startColumn > selection.endColumn) {
                    selection.endColumn = selection.startColumn
                }    
            }
        } else {
            if (selection.startRow > selection.endRow) {
                selection.startRow = selection.endRow
            }
            if (selection.startRow === selection.endRow) {
                if (selection.startColumn > selection.endColumn) {
                    selection.startColumn = selection.endColumn
                }    
            }
        }
        const rowLength = this.t.cols
        let selectionLength = rowLength*(selection.endRow - selection.startRow) + selection.endColumn - selection.startColumn
        if (selectionLength == 0) selectionLength = 1
        this.t.select(selection.startColumn, selection.startRow, selectionLength)
    }
}
