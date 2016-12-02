var Swarm = require('discovery-swarm')
var swarmDefaults = require('datland-swarm-defaults')
var hyperdriveHttp = require('hyperdrive-http')
var lru = require('lru')
var hyperdrive = require('hyperdrive')
var debug = require('debug')('archiver-server')

module.exports = function (archiver, opts) {
  opts = opts || {}
  opts.swarm = opts.swarm || true
  opts.http = opts.http || true

  // Dat Swarm options
  opts.datPort = opts.datPort || 3282
  opts.tcp = opts.tcp || true
  opts.utp = opts.utp || true

  return {
    swarm: opts.swarm ? createSwarm(archiver, opts) : null,
    httpRequest: opts.http ? hyperdriveHttp(getArchive(archiver, opts)) : null
  }
}

function getArchive (archiver, opts) {
  var drive = hyperdrive(archiver.db)
  var cache = lru(opts.cacheSize || 100)
  cache.on('evict', function (item) {
    // TODO ?
  })

  return function (dat, cb) {
    if (!dat.key) return cb('please provide key') // TODO: fix bug?
    debug('request', JSON.stringify(dat))

    var archive = cache.get(archiver.discoveryKey(new Buffer(dat.key, 'hex')).toString('hex'))
    if (archive) return cb(null, archive)
    debug('Getting archive from archiver:', dat.key)

    archiver.get(dat.key, function (err, feed, contentFeed) {
      if (err || !feed) return cb('not found')
      if (!contentFeed) return cb('TODO: hypercore feed, not archive')

      archive = drive.createArchive(dat.key, {
        metadata: feed,
        content: contentFeed
      })

      cache.set(archive.discoveryKey.toString('hex'), archive)
      cb(null, archive)
    })
  }
}

function createSwarm (archiver, opts) {
  if (!archiver) throw new Error('hypercore archiver required')
  if (!opts) opts = {}

  var swarm = Swarm(swarmDefaults({
    utp: opts.utp,
    tcp: opts.tcp,
    hash: false,
    stream: function () {
      return archiver.replicate() // TODO: can you do {upload, download} here?
    }
  }))
  swarm.once('error', function () {
    swarm.listen(0)
  })
  swarm.listen(opts.datPort)

  archiver.list().on('data', serveArchive)
  archiver.on('add', serveArchive)
  archiver.on('remove', function (key) {
    swarm.leave(archiver.discoveryKey(key))
  })

  return swarm

  function serveArchive (key) {
    // random timeout so it doesn't flood DHT
    debug(`Serving Archive ${key.toString('hex')} on Dat`)
    setTimeout(function () {
      swarm.join(archiver.discoveryKey(key))
    }, Math.floor(Math.random() * 30 * 1000))
  }
}
