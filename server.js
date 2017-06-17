const express = require('express');
const app = express();
// var http = require('http').Server(app);
// var io = require('socket.io')(http);
//var ffmpeg = require('fluent-ffmpeg');
//var stream = require('stream');
const fs = require('fs');
const spawn = require('child_process').spawn;
app.use(express.static('static'));

//testing
spawn('ffmpeg', ['-h']).on('error', function (m) {
    console.error("FFMpeg not found in system cli; please install ffmpeg properly or make a softlink to ./!");
    process.exit(-1);
});

const SSL_KEY = 'server.key';
const SSL_CERT = 'server.crt';
const option = {
    key: fs.readFileSync(SSL_KEY).toString(),
    cert: fs.readFileSync(SSL_CERT).toString()
};
const server = require('https').createServer(option, app);
const port = 8888;
//var io = require('socket.io').listen(server);
const WebSocket = require('ws');
const wss = new WebSocket.Server({ server });
server.listen(port, function () {
    console.log(`http and websocket listening on *:${port}`);
});


wss.on('connection', function (ws, req) {
    ws.orgSend = ws.send;
    ws.send = (body, type) => {
        if (type) {
            var msg = JSON.stringify({ type, body });
            ws.orgSend(msg);
        } else {
            ws.orgSend(body);
        }
    }
    ws.send('Hello from mediarecorder-to-rtmp server!', 'message');
    ws.send('Please set rtmp destination before start streaming.', 'message');
    ws.isAlive = true;
    ws.on('pong', function () {
        this.isAlive = true;
    });
    const interval = setInterval(_ => {
        wss.clients.forEach(ws => {
            if (ws.isAlive === false) return ws.terminate();
            ws.isAlive = false;
            ws.ping('', false, true);
        });
    }, 30000);

    let ffmpeg_process, feedStream = false;
    ws.on('message', data => {
        if (typeof data === 'string') {
            var msg = JSON.parse(data);
            switch (msg.type) {
                case 'start':
                    var regexValidator = /^rtmp:\/\/[^\s]*$/;
                    if (!regexValidator.test(msg.rtmpDestination)) {
                        ws.send('rtmp address rejected.', 'fatal');
                        return;
                    }
                    ws.send('rtmp destination set to:' + msg.rtmpDestination, 'message');
                    if (!/^[0-9a-z]{2,}$/.test(msg.vcodec)) {
                        socket.emit('input codec contains illegal character?.', 'fatal');
                        return;
                    }
                    start(ws, msg);
                    break;
            }
        } else {
            if (!feedStream) {
                ws.send('rtmp not set yet.', 'fatal');
                return;
            }
            feedStream(data);
        }
    });

    function start(ws, config) {
        if (ffmpeg_process || feedStream) {
            ws.send('stream already started.', 'fatal');
            return;
        }
        if (!config.rtmpDestination) {
            ws.send('no destination given.', 'fatal');
            return;
        }
        const ops = [
            '-vcodec', config.vcodec, '-i', '-',
            '-c:v', 'libx264', '-g', '10', '-preset', 'veryfast', '-tune', 'fastdecode,zerolatency',
            //'-c:v', 'libx264', '-vf','scale=iw*.5:ih*.5','-g', '10', '-preset', 'veryfast', '-tune', 'fastdecode,zerolatency',
            '-bufsize', '4000k', '-threads', '0',
            //'-c:v', 'libx264','-r', '10', '-preset', 'veryfast', '-tune', 'fastdecode,zerolatency','-analyzeduration', '2147483647', '-probesize', '2147483647',
            '-acodec', 'libfdk_aac', '-strict', 'experimental', '-ac', '1', '-ab', '96k', '-ar', '44100', '-vsync', 'passthrough',
            //'-an', //TODO: give up audio for now...
            //'-async', '1', 
            //'-filter_complex', 'aresample=44100', //necessary for trunked streaming?
            //'-strict', 'experimental', '-c:a', 'aac', '-b:a', '128k',ß
            '-f', 'flv', config.rtmpDestination
        ];
        ffmpeg_process = spawn('ffmpeg', ops);
        feedStream = function (data) {
            ffmpeg_process.stdin.write(data);
            //write exception cannot be caught here.	
        }

        ffmpeg_process.stderr.on('data', function (d) {
            ws.send('' + d, 'ffmpeg');
        });

        ffmpeg_process.on('error', function (e) {
            ws.send('ffmpeg error!' + e, 'fatal');
            feedStream = false;
            ws.close(1011);
        });

        ffmpeg_process.on('exit', function (e) {
            ws.send('ffmpeg exit!' + e, 'fatal');
            ws.close(1011);
        });
    }

    ws.on('close', _ => {
        feedStream = false;
        if (ffmpeg_process) {
            try {
                ffmpeg_process.stdin.end();
                ffmpeg_process.kill('SIGINT');
            } catch (e) {
                console.warn('killing ffmpeg process attempt failed...');
            }
        }
    });

    ws.on('error', function (e) {
        console.log('socket.io error:' + e);
    });
});


process.on('uncaughtException', function (err) {
    // handle the error safely
    console.log(err);
    // Note: after client disconnect, the subprocess will cause an Error EPIPE, which can only be caught this way.
});


