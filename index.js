var inherits = require('inherits');
var Readable = require('readable-stream').Readable;
var spawn = require('child_process').spawn;

module.exports = function (opts, fn) {
    if (typeof opts === 'function') {
        fn = opts;
        opts = {};
    }
    if (!opts) opts = {};
    var b = new B (opts);
    if (typeof fn === 'function') b.push(fn);
    return b;
};

function B (opts) {
    var self = this;
    Readable.call(self);
    
    self.readable = true;
    self.rate = opts.rate || 44000;
    
    self.channels = [];
    self.t = 0;
    self.i = 0;
}

inherits(B, Readable);

B.prototype.addChannel = function (type, fn) {
    if (typeof type === 'function') {
        fn = type;
        type = 'float';
    }
    this.channels.push([ type, [ fn ].filter(Boolean) ]);
};

B.prototype.push = function (ix, fn) {
    if (typeof ix === 'function') {
        fn = ix;
        ix = 0;
    }
    if (!this.channels[ix]) {
        this.channels[ix] = [ 'float', [] ];
    }
    this.channels[ix][1].push(fn);
};

B.prototype._read = function (bytes) {
    if (!bytes) bytes = 4096;
    var self = this;
    
    var buf = new Buffer(Math.floor(bytes / self.channels.length));
    function clamp (x) {
        return Math.max(Math.min(x, Math.pow(2,15)-1), -Math.pow(2,15));
    }
    
    for (var i = 0; i < buf.length; i += 2) {
        var ch = self.channels[(i / 2) % self.channels.length];
        var t = self.t + Math.floor(i / 2) / self.rate / self.channels.length;
        var counter = self.i + Math.floor(i / 2 / self.channels.length);
        
        var value = 0;
        var n = 0;
        for (var j = 0; j < ch[1].length; j++) {
            var x = ch[1][j].call(self, t, counter);
            if (!isNaN(x)) n += x;
        }
        n /= ch[1].length;
        
        if (ch[0] === 'float') {
            value = signed(n);
        }
        else {
            var b = Math.pow(2, ch[0]);
            var x = (Math.floor(n) % b) / b * Math.pow(2, 15);
            if (isNaN(x)) x = 0;
            value = x;
        }
        
        buf.writeInt16LE(clamp(value), i);
    }
    
    self.i += buf.length / 2;
    self.t += buf.length / 2 / self.rate;
    
    Readable.prototype.push.call(self, buf);
};

B.prototype.end = function () {
    Readable.prototype.push.call(this, null);
};

function mergeArgs (opts, args) {
    Object.keys(opts || {}).forEach(function (key) {
        args[key] = opts[key];
    });
    
    return Object.keys(args).reduce(function (acc, key) {
        var dash = key.length === 1 ? '-' : '--';
        return acc.concat(dash + key, args[key]);
    }, []);
}

B.prototype.play = function (opts) {
    // using the play command from http://sox.sourceforge.net/
    
    var ps = spawn('play', mergeArgs(opts, {
        'c' : this.channels.length,
        'r' : this.rate,
        't' : 's16',
    }).concat('-'));
    
    this.pipe(ps.stdin);
    return ps;
};

B.prototype.record = function (file, opts) {
    // using the sox command from http://sox.sourceforge.net/
    var ps = spawn('sox', mergeArgs(opts, {
        'c' : this.channels.length,
        'r' : this.rate,
        't' : 's16',
    }).concat('-', '-o', file));
    
    this.pipe(ps.stdin);
    return ps;
};

function signed (n) {
    if (isNaN(n)) return 0;
    var b = Math.pow(2, 15);
    return n > 0
        ? Math.min(b - 1, Math.floor((b * n) - 1))
        : Math.max(-b, Math.ceil((b * n) - 1))
    ;
}
