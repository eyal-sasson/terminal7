import { Terminal7 } from "./terminal7"

export type CallbackType = (e: unknown) => void
export type ChannelID = number
export type State = "new" | "connecting" | "connected" | "reconnected" | "disconnected" | "failed" | "unauthorized" | "wrong password"

// possible reasons for a failure
export enum Failure {
    NotImplemented='Not Implemented',
    WrongPassword='Wrong Password',
    Unauthorized='Unauthorized',
    BadMarker='Bad Marker',
    BadRemoteDescription='Bad Remote Description',
    NotSupported='Not Supported',
    WebexecNotFound='Webexec Not Found',
    TimedOut='Timeout',
    Aborted='Aborted',
    KeyRejected='Key Rejected',
    WrongAddress='Wrong Address',
    DataChannelLost="Data Channel Lost",
    FailedToConnect="Failed To Connect",
}

export interface Event {
    state: string
    data: string
    error: string
}

export interface Channel {
    id?: ChannelID
    onClose : CallbackType
    onMessage : CallbackType
    close(): Promise<void>
    send(data: string): void
    resize(sx: number, sy: number): Promise<void>
    get readyState(): string
}

export interface Session {
    readonly isSSH: boolean
    onStateChange : (state: State, failure?: Failure) => void
    onPayloadUpdate: (payload: string) => void
    // for reconnect
    openChannel(id: ChannelID): Promise<Channel>
    // for new channel
    openChannel(cmd: string | string[], parent?: ChannelID, sx?: number, sy?: number):
        Promise<Channel>
    close(): void
    getPayload(): Promise<string | null>
    setPayload(payload: string): Promise<void>
    reconnect(marker?: number, publicKey?: string, privateKey?: string): Promise<void>
    disconnect(): Promise<void>
    connect(marker?:number | null, publicKey?: string, privateKey?: string): void
    fail(failure?: Failure): void
}

export abstract class BaseChannel implements Channel {
    id?: ChannelID
    t7: object
    onClose : CallbackType
    onMessage : CallbackType
    abstract close(): Promise<void> 
    abstract send(data: string): void
    abstract resize(sx: number, sy: number): Promise<void>

    constructor() {
        this.onMessage = () => void 0
        this.onClose = () => void 0
        this.t7 = window.terminal7
    }

    get readyState(): string {
        return "open"
    }
}
export abstract class BaseSession implements Session {
    t7: Terminal7
    watchdog: number
    onStateChange : (state: State, failure?: Failure) => void
    onPayloadUpdate: (payload: string) => void
    constructor() {
        this.t7 = window.terminal7
    }
    get isSSH(): boolean {
        throw new Error("Not implemented")
    }
    async getPayload(): Promise<string | null> {
        return null
    }
    // TODO: get it to throw "Not Implemented"
    async setPayload(payload) {
        console.log(`ignoring set payload: ${JSON.stringify(payload)}`)
    }
    async reconnect(): Promise<void> {
        throw "Not Implemented"
    }
    // base disconnect is rejected as it's not supported
    disconnect(): Promise<void>{
        return new Promise((resolve, reject) => {
            reject()
        })
    }
    // fail function emulates a WebRTC connection failure flow
    fail(failure?: Failure) {
        if (this.onStateChange)
            this.onStateChange("failed", failure)
    }
    abstract close(): void
    // for reconnect
    abstract openChannel(id: ChannelID): Promise<Channel>
    abstract openChannel(cmd: string | ChannelID, parent?: ChannelID, sx?: number, sy?: number):
        Promise<Channel> 
    abstract connect(): void
}
