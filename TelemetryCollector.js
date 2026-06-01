class TelemetryCollector {
    constructor(hls, video, config = {}) {
        this.hls   = hls;
        this.video = video;
        this.config = {
            clientId   : config.clientId   || "client-" + Date.now().toString(36),
            contentId  : config.contentId  || "unknown",
            customerId : config.customerId || "unknown",
            backendUrl : config.backendUrl || "/telemetry",
            batchSize  : config.batchSize  || 5,
            debug      : config.debug      || false,
        };
        this._bufferStartTime    = null;
        this._currentQuality     = null;
        this._eventQueue         = [];
        this._allCollectedEvents = [];

        this._onManifestParsed = this._onManifestParsed.bind(this);
        this._onLevelSwitched  = this._onLevelSwitched.bind(this);
        this._onBufferStart    = this._onBufferStart.bind(this);
        this._onBufferEnd      = this._onBufferEnd.bind(this);
    }

    start() {
        this.hls.on(Hls.Events.MANIFEST_PARSED, this._onManifestParsed);
        this.hls.on(Hls.Events.LEVEL_SWITCHED,  this._onLevelSwitched);
        this.video.addEventListener("waiting", this._onBufferStart);
        this.video.addEventListener("playing", this._onBufferEnd);
        console.log("%c[TC] Started!", "color:#4caf50;font-weight:bold");
    }

    _onManifestParsed(event, data) {
        const i              = this.hls.startLevel >= 0 ? this.hls.startLevel : 0;
        this._currentQuality = data.levels[i] ? data.levels[i].height + "p" : "unknown";
        console.log("%c[TC] Stream loaded. Quality:", "color:#7c9fff;font-weight:bold", this._currentQuality);
        console.log("%c[TC] Available qualities:", "color:#7c9fff;font-weight:bold", data.levels.map(l => l.height + "p").join(", "));
    }

    _onLevelSwitched(event, data) {
        const level = this.hls.levels[data.level];
        if (!level) return;
        const newQ = level.height + "p";
        if (newQ === this._currentQuality) return;

        const evt = {
            type        : "QUALITY_CHANGE",
            clientId    : this.config.clientId,
            contentId   : this.config.contentId,
            customerId  : this.config.customerId,
            fromQuality : this._currentQuality,
            toQuality   : newQ,
            bitrate     : level.bitrate,
            timestamp   : Date.now(),
        };

        this._currentQuality = newQ;
        console.log("%c[TC] QUALITY_CHANGE", "color:#7c9fff;font-weight:bold", evt);
        this._record(evt);
    }

    _onBufferStart() {
        if (this._bufferStartTime !== null) return;
        this._bufferStartTime = Date.now();

        const evt = {
            type      : "BUFFER_START",
            clientId  : this.config.clientId,
            contentId : this.config.contentId,
            customerId: this.config.customerId,
            quality   : this._currentQuality,
            timestamp : this._bufferStartTime,
        };

        console.log("%c[TC] BUFFER_START", "color:#ff5722;font-weight:bold", evt);
        this._record(evt);
    }

    _onBufferEnd() {
        if (this._bufferStartTime === null) return;
        const dur         = Date.now() - this._bufferStartTime;
        this._bufferStartTime = null;
        if (dur < 100) return;

        const evt = {
            type      : "BUFFER_END",
            clientId  : this.config.clientId,
            contentId : this.config.contentId,
            customerId: this.config.customerId,
            quality   : this._currentQuality,
            durationMs: dur,
            timestamp : Date.now(),
        };

        console.log("%c[TC] BUFFER_END", "color:#4caf50;font-weight:bold", evt);
        this._record(evt);
    }

    _record(e) {
        this._allCollectedEvents.push(e);
        this._eventQueue.push(e);
        if (this._eventQueue.length >= this.config.batchSize) this._flush();
    }

    _flush() {
        if (!this._eventQueue.length) return;
        const batch      = [...this._eventQueue];
        this._eventQueue = [];
        console.log("%c[TC] Batch ready to send:", "color:#ffd700;font-weight:bold", batch);
    }

    destroy() {
        this._flush();
        this.hls.off(Hls.Events.MANIFEST_PARSED, this._onManifestParsed);
        this.hls.off(Hls.Events.LEVEL_SWITCHED,  this._onLevelSwitched);
        this.video.removeEventListener("waiting", this._onBufferStart);
        this.video.removeEventListener("playing", this._onBufferEnd);
        console.log("%c[TC] Destroyed", "color:#ff5722;font-weight:bold");
    }

    getSessionSummary() {
        const b = this._allCollectedEvents.filter(e => e.type === "BUFFER_END");
        const q = this._allCollectedEvents.filter(e => e.type === "QUALITY_CHANGE");
        return {
            clientId        : this.config.clientId,
            currentQuality  : this._currentQuality,
            totalBufferings : b.length,
            totalBufferMs   : b.reduce((s, e) => s + e.durationMs, 0),
            qualityChanges  : q.length,
            totalEvents     : this._allCollectedEvents.length,
            allEvents       : this._allCollectedEvents,
        };
    }
}


const myVideo = document.getElementById("video");
const myHls   = new Hls();

myHls.loadSource("https://streaming-simulator-prod.hivestreaming.com/generic/live/beta-big-bunny-multi/manifest.m3u8");
myHls.attachMedia(myVideo);

myHls.on(Hls.Events.MANIFEST_PARSED, () => {
    window.collector = new TelemetryCollector(myHls, myVideo, {
        clientId   : "viewer-001",
        contentId  : "hive-webcast",
        customerId : "hive-enterprise",
        backendUrl : "https://api.hivestreaming.com/telemetry",
        batchSize  : 5,
        debug      : true,
    });

    window.collector.start();

    console.log("%c Collector running!", "color:#4caf50;font-weight:bold;font-size:14px");
    console.log("%cType collector.getSessionSummary() to see collected data", "color:#888888;font-size:12px");
});
