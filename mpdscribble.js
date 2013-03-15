var _mpd=require('./mpd.js');
var mpd = _mpd.connect(6600);
var prev_song, prev_song_des, song_duration, prev_range;
var prev_state;
var elapsed;
var last_timestamp = null;
var lastfm = require('lastfm').LastFmNode;
var token =
var lf = new lastfm({
	api_key:,    // sign-up for a key at http://www.last.fm/api
	secret:,
	useragent: 'MPD/v0.17 Music player daemon' // optional. defaults to lastfm-node.
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
		console.log(song.timestamp ? "Scrobbled " : "Sent nowplaying " +
			    song.track + " successful");
	};
}
var lastfm_error = function(song){
	return function(t, err){
		console.log(song.timestamp ? "Scrobbled " : "Sent nowplaying " +
			    song.track + " failed");
		console.log(t);
		console.log(err);
	}
}
var lastfm_retry = function(song){
	return function(retry){
		console.log(song.timestamp ? "Scrobbled " : "Sent nowplaying " +
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
	mpd.send('status', function(result, last){
		console.log(result);
		if(result.state != prev_state){
			if(result.state == 'pause'){
				handle_pause(result);
				return main_loop(lfs);
			}
			last_timestamp = process.hrtime();
		}
		prev_state = result.state;
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
				elapsed += duration[0] + duration[1]/1000000000;
				console.log(elapsed + "seconds played");
				if(elapsed >= 0.8*song_duration){
					//Scrobble old song
					console.log("Scrobbling "+prev_song_des.track);
					var lfu = lf.update('scrobble', lfs, prev_song_des);
					prev_song_des.timestamp = Date.now() / 1000;
					lfu.on('success', lastfm_success(prev_song_des));
					lfu.on('retrying', lastfm_retry(prev_song_des));
					lfu.on('error', lastfm_error(prev_song_des));
				}
				//Send now listening
				prev_song_des =  {
					artist: smart_artist(result),
					track: result.Title,
					album: result.Album,
					trackNumber: result.Track,
					duration: result.Time,
					albumArtist: result.AlbumArtist,
				};
				console.log("nowplaying "+prev_song_des.track);
				var lfu = lf.update('nowplaying', lfs, prev_song_des);
				lfu.on('success', lastfm_success(prev_song_des));
				lfu.on('retrying', lastfm_retry(prev_song_des));
				lfu.on('error', lastfm_error(prev_song_des));
				prev_song = result.file;
				song_duration = result.Time;
			}else{
				console.log("Same song");
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
	mpd.send('currentsong', function(result, last){
		prev_song_des =  {
			artist: smart_artist(result),
			track: result.Title,
			album: result.Album,
			trackNumber: result.Track,
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
mpd.on('connect', function(err){
	if(err){
		console.log(err);
		return;
	}
	var lfs = lf.session();
	lfs.authorise(token);
	lfs.on('authorised', first_run);
	lfs.on('error', function(t, err){
		console.log(err);
		console.log(t);
		mpd.end();
		return;
	});
});
