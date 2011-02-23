
/**
 * Module dependencies.
 */

var connect = require('connect')
  , assert = require('assert')
  , should = require('should')
  , http = require('http');

// session store

var MemoryStore = connect.session.MemoryStore
  , store = new MemoryStore({ reapInterval: -1 });

// settings

var port = 9900
  , portno = port
  , pending = 0

// main test app

var app = connect.createServer(
    connect.cookieParser()
  , connect.session({ secret: 'keyboard cat', store: store })
  , function(req, res, next){
    res.end('wahoo');
  }
);

app.listen(port);

// SID helper

function sid(cookie) {
  return /^connect\.sid=([^;]+);/.exec(cookie[0])[1];
}

// proxy http.get() to buffer body

var get = http.get;
http.get = function(options, fn){
  if (!options.buffer) return get.apply(this, arguments);
  get(options, function(res){
    res.body = '';
    res.on('data', function(chunk){ res.body += chunk });
    res.on('end', function(){ fn(res); });
  });
};

module.exports = {
  'test exports': function(){
    connect.session.Session.should.be.a('function');
    connect.session.Store.should.be.a('function');
    connect.session.MemoryStore.should.be.a('function');
  },

  'test Set-Cookie': function(){
    ++pending;
    http.get({ port: port }, function(res){
      var prev = res.headers['set-cookie'];
      prev.should.match(/^connect\.sid=([^;]+); path=\/; httpOnly; expires=/);
      http.get({ port: port }, function(res){
        var curr = res.headers['set-cookie'];
        curr.should.match(/^connect\.sid=([^;]+); path=\/; httpOnly; expires=/);
        sid(prev).should.not.equal(sid(curr));
        --pending || app.close();
      });
    });
  },
  
  'test SID maintenance': function(){
    pending += 6;
    http.get({ port: port }, function(res){
      --pending;
      var prev = res.headers['set-cookie'];
      prev.should.match(/^connect\.sid=([^;]+); path=\/; httpOnly; expires=/);
      var headers = { Cookie: 'connect.sid=' + sid(prev) }
        , n = 5;

      // ensure subsequent requests maintain the SID
      while (n--) {
        http.get({ port: port, headers: headers }, function(res){
          var curr = res.headers['set-cookie'];
          curr.should.match(/^connect\.sid=([^;]+); path=\/; httpOnly; expires=/);
          sid(prev).should.equal(sid(curr));
          --pending || app.close();
        });
      }
    });
  },
  
  'test SID changing': function(){
    pending += 5;
    var sids = []
      , n = 5;

    // ensure different SIDs
    while (n--) {
      http.get({ port: port }, function(res){
        var curr = sid(res.headers['set-cookie']);
        sids.should.not.contain(curr);
        sids.push(curr);
        --pending || app.close();
      });
    }
  },

  'test multiple Set-Cookie headers via writeHead()': function(){
    var app = connect.createServer(
        connect.cookieParser()
      , connect.session({ secret: 'keyboard cat', store: store, key: 'sid' })
      , function(req, res, next){
        res.setHeader('Set-Cookie', 'foo=bar');
        res.writeHead(200, { 'Set-Cookie': 'bar=baz' });
        res.end('wahoo');
      }
    );

    assert.response(app,
      { url: '/' },
      function(res){
        var cookies = res.headers['set-cookie'];
        cookies.should.have.length(3);
        cookies[0].should.equal('foo=bar');
        cookies[2].should.equal('bar=baz');
      });
  },
  
  'test multiple Set-Cookie headers via setHeader()': function(){
    var app = connect.createServer(
        connect.cookieParser()
      , connect.session({ secret: 'keyboard cat', store: store, key: 'sid' })
      , function(req, res, next){
        res.setHeader('Set-Cookie', 'foo=bar');
        res.setHeader('Set-Cookie', 'bar=baz');
        res.end('wahoo');
      }
    );

    assert.response(app,
      { url: '/' },
      function(res){
        var cookies = res.headers['set-cookie'];
        cookies.should.have.length(3);
        cookies[0].should.equal('foo=bar');
        cookies[1].should.equal('bar=baz');
      });
  },
  
  'test key option': function(){
    var app = connect.createServer(
        connect.cookieParser()
      , connect.session({ secret: 'keyboard cat', store: store, key: 'sid' })
      , function(req, res, next){
        res.end('wahoo');
      }
    );

    assert.response(app,
      { url: '/' },
      { headers: {
        'Set-Cookie': /^sid=([^;]+); path=\/; httpOnly; expires=/
      }});
  },
  
  'test req.session data persistence': function(){
    var prev
      , port = ++portno
      , app = connect.createServer(
        connect.cookieParser()
      , connect.session({ secret: 'keyboard cat', store: store })
      , function(req, res, next){
        req.session.lastAccess.should.not.equal(prev);  
        req.session.count = req.session.count || 0;
        var n = req.session.count++;
        res.end('count: ' + n);
      }
    );

    app.listen(port, function(){
      var options = { port: port, buffer: true };
      // 0
      http.get(options, function(res){
        options.headers = { Cookie: 'connect.sid=' + sid(res.headers['set-cookie']) };
        res.body.should.equal('count: 0');

        // 1
        http.get(options, function(res){
          res.body.should.equal('count: 1');

          // no sid
          delete options.headers;
          http.get(options, function(res){
            res.body.should.equal('count: 0');
            app.close();
          });
        });
      });
    });
  },
  
  'test req.session.regenerate()': function(){
    var prev
      , port = ++portno
      , app = connect.createServer(
        connect.cookieParser()
      , connect.session({ secret: 'keyboard cat', store: store })
      , function(req, res, next){
        req.session.lastAccess.should.not.equal(prev);  
        req.session.count = req.session.count || 0;
        var n = req.session.count++
          , sid = req.session.id;

        req.sessionID.should.equal(sid);

        switch (req.url) {
          case '/regenerate':
            req.session.regenerate(function(err){
              should.equal(null, err);
              res.end('count: ' + n);
              req.session.id.should.not.equal(sid);
              req.sessionID.should.not.equal(sid);
              req.sessionID.should.equal(req.session.id);
            });
            break;
        }

        res.end('count: ' + n);
      }
    );

    app.listen(port, function(){
      var options = { port: port, buffer: true };
      // 0
      http.get(options, function(res){
        var prev = sid(res.headers['set-cookie']);
        options.headers = { Cookie: 'connect.sid=' + prev };
        res.body.should.equal('count: 0');

        // regenerated
        options.path = '/regenerate';
        http.get(options, function(res){
          prev.should.not.equal(sid(res.headers['set-cookie']));
          res.body.should.equal('count: 1');

          // 1
          options.path = '/';
          http.get(options, function(res){
            res.body.should.equal('count: 0');
            app.close();
          });
        });
      });
    });
  },
  
  'test req.session.destroy()': function(){
    var prev
      , port = ++portno
      , app = connect.createServer(
        connect.cookieParser()
      , connect.session({ secret: 'keyboard cat', store: store })
      , function(req, res, next){
        req.session.lastAccess.should.not.equal(prev);  
        req.session.count = req.session.count || 0;
        var n = req.session.count++
          , sid = req.session.id;
  
        req.sessionID.should.equal(sid);
  
        switch (req.url) {
          case '/destroy':
            req.session.destroy(function(err){
              should.equal(null, err);
              should.equal(null, req.session);
              res.end('count: ' + n);
            });
            break;
        }
  
        res.end('count: ' + n);
      }
    );
  
    app.listen(port, function(){
      var options = { port: port, buffer: true };
      // 0
      http.get(options, function(res){
        var prev = sid(res.headers['set-cookie']);
        options.headers = { Cookie: 'connect.sid=' + prev };
        res.body.should.equal('count: 0');
  
        // destroy
        options.path = '/destroy';
        http.get(options, function(res){
          res.headers.should.not.have.property('set-cookie');
          res.body.should.equal('count: 1');
  
          // 1
          options.path = '/';
          http.get(options, function(res){
            res.body.should.equal('count: 0');
            app.close();
          });
        });
      });
    });
  },
  
  'test event pausing': function(){
    var request
      , store = new MemoryStore({ reapInterval: -1 });

    store.get = function(sid, fn){
      request.emit('data', 'foo');
      request.emit('data', 'bar');
      request.emit('data', 'baz');
      setTimeout(function(){
        fn(null, {});
      }, 100);
    };

    var port = ++portno
      , app = connect.createServer(
        function(req, res, next){
          request = req;
          next();
        }
      , connect.cookieParser()
      , connect.session({ secret: 'keyboard cat', store: store })
      , function(req, res, next){
        req.pipe(res);
      }
    );

    app.listen(port, function(){
      var options = { port: port, buffer: true };
      http.get(options, function(res){
        options.headers = { Cookie: 'connect.sid=' + sid(res.headers['set-cookie']) };
        http.get(options, function(res){
          res.body.should.equal('foobarbaz');
          app.close();
        });
      });
    });
  },
  
  'test Set-Cookie when secure': function(){
    var store = new MemoryStore({ reapInterval: -1, cookie: { secure: true }});
    var port = ++portno
      , app = connect.createServer(
        connect.cookieParser()
      , connect.session({ secret: 'foo', store: store })
      , function(req, res){
        res.end('wahoo');
      }
    );

    app.listen(port, function(){
      var options = { port: port, buffer: true };
      http.get(options, function(res){
        res.headers.should.not.have.property('set-cookie');
        app.close();
      });
    });
  }
};