

export class PeerbookConnection {
    ws: WebSocket = null
    host: string = "https://api.peerbook.io"
    peerName: string
    insecure: boolean = false
    email: string
    fp: string
    pbSendTask = null
    onUpdate: (r: string) => void
    pending: Array<string>

    constructor(fp, email, peerName, host = "api.peerbook.io", insecure = false) {
        this.fp = fp
        this.email = email
        this.peerName = peerName
        this.host = host
        this.insecure = insecure
        this.pending = new Array()
    }
    connect() {
        var firstMessage = true
        return new Promise((resolve, reject) =>{
            if (this.ws != null) {
                resolve()
                return
            }
            const schema = this.insecure?"ws":"wss",
                  url = encodeURI(`${schema}://${this.host}/ws?fp=${this.fp}&name=${this.peerName}&kind=terminal7&email=${this.email}`)
            this.ws = new WebSocket(url)
            this.ws.onmessage = ev => this.onUpdate(ev.data)
            this.ws.onerror = ev => {
                    // TODO: Add some info avour the error
                terminal7.notify("\uD83D\uDCD6 WebSocket Error")
            }
            /*
            this.ws.onclose = ev => {
                this.ws.onclose = undefined
                this.ws.onerror = undefined
                this.ws.onmessage = undefined
                this.ws = null
            }*/
            this.ws.onopen = ev => {
                resolve()
                if ((this.pbSendTask == null) && (this.pending.length > 0))
                    this.pbSendTask = setTimeout(() => {
                        this.pending.forEach(m => {
                            console.log("sending ", m)
                            this.ws.send(JSON.stringify(m))
                        })
                        this.pbSendTask = null
                        this.pending = []
                    }, 10)
            }
        })
    }
    send(m) {
        // null message are used to trigger connection, ignore them
        if (m != null) {
            if (this.ws != null 
                && this.ws.readyState == WebSocket.OPEN) {
                this.ws.send(JSON.stringify(m))
                return
            }
            this.pending.push(m)
        }
        this.ws.send(JSON.stringify(m))
    }
    close() {
        this.ws.close()
        this.ws = null
    }
}
