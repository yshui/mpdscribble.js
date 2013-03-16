var _mpd=require('./mpd.js');
var prev_song, prev_song_des, song_duration, prev_range;
var prev_state;
var elapsed;
var last_timestamp = null;
var lastfm = require('lastfm').LastFmNode;
var rl = require('readline').createInterface({
	input: process.stdin,
	output: process.stdout
});

var handle_pause = function(result){
	elapsed = parseFloat(result.elapsed);
	last_timestamp = process.hrtime();
	//cancel now listening
	prev_state = result.state;
}
var lastfm_success = function(song){
	return function(){
		console.log(song);
		console.log((song.timestamp ? "Scrobbled " : "Sent nowplaying ") +
			    song.track + " successful");
	};
}
var lastfm_error = function(song){
	return function(t, err){
		console.log((song.timestamp ? "Scrobbled " : "Sent nowplaying ") +
			    song.track + " failed");
		console.log(t);
		console.log(err);
	}
}
var lastfm_retry = function(song){
	return function(retry){
		console.log((song.timestamp ? "Scrobbled " : "Sent nowplaying ") +
			    song.track + " failed");
		console.log(retry.error + " " + retry.message);
		console.log("Will retry in " + retry.delay/1000 + " seconds");
	}
}
var smart_artist = function(mpd_song){
	if(mpd_song.Artist)
		return mpd_song.Artist;
	if(mpd_song.AlbumArtist)
		return mpd_song.AlbumArtist;
	return "Unknown";
}
var handle_idle_result = function(lfs, c){
	if(c.changed != "player")
		return main_loop(lfs);
	console.log(c.changed);
	mpd.send('status', function(status_result, last){
		console.log(status_result);
		if(status_result.state != prev_state){
			if(status_result.state == 'pause'){
				handle_pause(status_result);
				return main_loop(lfs);
			}
			last_timestamp = process.hrtime();
		}
		prev_state = status_result.state;
		/*format
		  { file: 'midori/Midori/2008 - Live!! (Live at Hibiya Yagai Ongakudo, June 22, 2008)/07 POP.mp3',
		  'Last-Modified': '2013-03-15T17:13:59Z',
		  Time: '225',
		  Artist: 'Midori',
		  Title: 'POP',
		  Album: 'Live!!',
		  Track: '07',
		  Genre: 'Punk',
		  Pos: '9',
		  Id: '77' }
		*/
		mpd.send('currentsong', function(result, last){
			console.log(result);
			console.log("song file " + prev_song);
			console.log("range " + prev_range);
			if(result.file != prev_song || result.Range != prev_range){
				var duration = process.hrtime(last_timestamp);
				last_timestamp = process.hrtime();
				elapsed += duration[0] + duration[1]/1000000000;
				console.log(elapsed + "seconds played");
				if(elapsed >= parseFloat(cfg.scrobble_thershold)*song_duration){
					//Scrobble old song
					console.log("Scrobbling "+prev_song_des.track);
					prev_song_des.timestamp = (Date.now() / 1000).toFixed(0);
					var lfu = lf.update('scrobble', lfs, prev_song_des);
					lfu.on('success', lastfm_success(prev_song_des));
					lfu.on('retrying', lastfm_retry(prev_song_des));
					lfu.on('error', lastfm_error(prev_song_des));
				}
				//Send now listening
				prev_song_des =  {
					artist: smart_artist(result),
					track: result.Title,
					album: result.Album,
					trackNumber: parseInt(result.Track),
					duration: result.Time,
					albumArtist: result.AlbumArtist,
				};
				console.log("nowplaying "+prev_song_des.track);
				var lfu = lf.update('nowplaying', lfs, prev_song_des);
				lfu.on('success', lastfm_success(prev_song_des));
				lfu.on('retrying', lastfm_retry(prev_song_des));
				lfu.on('error', lastfm_error(prev_song_des));
				prev_song = result.file;
				prev_range = result.Range;
				song_duration = result.Time;
				elapsed = 0;
			}else{
				console.log("Same song");
				last_timestamp = process.hrtime();
				elapsed = parseFloat(status_result.elapsed);
			}
			return main_loop(lfs);
		});
	});
}
var main_loop = function(lfs){
	console.log("main()");
	mpd.send('idle', function(result, last){
		console.log(result);
		setTimeout(function(){handle_idle_result(lfs, result)}, 0);
	});
}
var first_run = function(lfs){
	console.log("first_run()");
	console.log("Write config file");
	console.log(lfs.key);
	mpd.send('currentsong', function(result, last){
		prev_song_des =  {
			artist: smart_artist(result),
			track: result.Title,
			album: result.Album,
			trackNumber: parseInt(result.Track),
			duration: result.Time,
			albumArtist: result.AlbumArtist,
		};
		var lfu = lf.update('nowplaying', lfs, prev_song_des);
		lfu.on('success', lastfm_success(prev_song_des));
		lfu.on('retrying', lastfm_retry(prev_song_des));
		lfu.on('error', lastfm_error(prev_song_des));
		song_duration = prev_song_des.duration;
		prev_song = result.file;
		prev_range = result.Range;
		mpd.send('status', function(res, last){
			elapsed = parseFloat(res.elapsed);
			last_timestamp = process.hrtime();
			prev_state = res.state;
			main_loop(lfs);
		});
	});
}
var mpd_connected;
var mpd_connect = function(lfs){
	console.log("mpd");
	if(mpd_connected)
		return first_run(lfs);
	mpd.on('connect',function(){first_run(lfs);});
}
var get_session_key = function(){
	console.log(lf);
	var lfr = lf.request('auth.getToken', {signed:true});
	lfr.on('success', function(j){
		rl.write("Here, open this link: http://www.last.fm/api/auth/?api_key="+lf.api_key+"&token="+j.token+"\n");
		rl.question("Press Enter when you are done", function(yes){
			var lfs = lf.session();
			console.log("a");
			lfs.authorise(j.token);
			lfs.on('authorised', function(){
				console.log("authorised");
				cfg.user_name = lfs.user;
				cfg.session_key = lfs.key;
				var tmp = JSON.stringify(cfg, null, "\t");
				fs.writeFile(".mpdscribble.js", tmp);
				mpd_connect(lfs);
			});
			lfs.on('error', function(t, err){
				console.log("failed to get session_key");
				console.log(err);
				console.log(t);
				mpd.end();
				return;
			});
		});
	});
	lfr.on('error', function(err){
		console.log("request error");
		console.log(err);
	});
}
var fs=require("fs");
var buf = fs.readFileSync("./.mpdscribble.js");
var cfg = buf.toString();
cfg = cfg.replace(/^\/\/.*$/, "");
cfg = cfg.replace(/\n/g, "");
console.log(cfg);
try{
	cfg = JSON.parse(cfg);
	console.log(cfg);
}catch(err){
	console.log("Failed to read config "+err);
	return;
}
if(!cfg.api_key || !cfg.secret){
	console.log("API Key & secret not specified");
	return;
}
var mpd;
if(!cfg.mpd_socket){
	var host = process.env.MPD_HOST;
	var port;
	if(!host.match(/^\//)){
		port = process.env.MPD_PORT;
		mpd = _mpd.connect({port: port, host:host});
	}else
		mpd = _mpd.connect({path: host});
}else{
	if(cfg.mpd_socket.match(/^\//)){
		mpd = _mpd.connect({path: cfg.mpd_socket})
	}else{
		if(cfg.mpd_socket.match(':')){
			var b = cfg.mpd_socket.split(':');
			mpd = _mpd.connect({port:b[1], host:b[0]});
		}else
			mpd = _mpd.connect({port:cfg.mpd_socket});
	}
}
mpd.on('connect', function(err){
	console.log("mpd.connect");
	mpd_connected = true;
});
mpd.on('error', function(er){
	console.log(er);
});
var lf = new lastfm({
	api_key: cfg.api_key,
	secret: cfg.secret,
	useragent: 'MPD/v0.17 Music player daemon'
});
if(!cfg.session_key || !cfg.user_name)
	get_session_key();
else
	mpd_connect(lf.session(cfg.user_name, cfg.session_key));
