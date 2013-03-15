var events = require('events'),
    util = require('util'),
    net = require('net');

var result_parser = function(arr){
	var res={};
	for (i in arr){
		var b = arr[i].split(/\s*:\s*/);
		res[b[0]] = arr[i].replace(b[0], "").replace(/^\s*:\s*/, "");
	}
	return res;
}
var MPD = function (options, callback) {
    this.dataBuffer = '';
    this.frameBuffer = [];
    this.version = null;

    var mpd = this;
    this.callbacks = [
        function (result, lastFrame) {
            var match = /^OK MPD ([\.\d]+)$/.exec(lastFrame);

            if (match) {
                mpd.version = match[1];
                mpd.emit('connect');
            } else {
                mpd.emit('error', new Error("Invalid MPD banner"));
            }
        }
    ];

    this.socket = net.connect(options);
    this.socket.on('error', this.emit.bind(this, 'error'));
    this.socket.on('data', this._data.bind(this));
    this.socket.on('frame', this._frame.bind(this));
    this.socket.on('response', this._response.bind(this));
    this.end = this.socket.end.bind(this.socket);
    this.destroy = this.socket.destroy.bind(this.socket);
};

util.inherits(MPD, events.EventEmitter);

MPD.prototype.send = function (command, callback) {
    this.socket.write(command + "\n");
    this.callbacks.push(callback);
};

MPD.prototype._data = function (data) {
    var chunk = this.dataBuffer + data;

    if (chunk.indexOf("\n") >= 0) {
        var frames = chunk.split("\n");
        chunk = frames.pop();

        for (var i = 0; i < frames.length; i++) {
            this.socket.emit('frame', frames[i]);
        }
    }

    this.dataBuffer = chunk;
};

MPD.prototype._frame = function (frame) {
    if (/^(OK|ACK)/.test(frame)) {
        this.socket.emit('response', this.frameBuffer, frame);
        this.frameBuffer = [];
    } else {
        this.frameBuffer.push(frame);
    }
};

MPD.prototype._response = function (result, lastFrame) {
    var callback = this.callbacks.shift();

    if (typeof callback == 'function') {
        callback(result_parser(result), lastFrame);
    }
};


module.exports.MPD = MPD;
module.exports.connect = function (options) {
    return new MPD(options);
};
