'use strict'

const { replicationPairConfigured } = require('../config/replication-config')
const { handleGet } = require('./routes-replication-get')
const { handlePost } = require('./routes-replication-post')

module.exports = { handleGet, handlePost, replicationPairConfigured }
