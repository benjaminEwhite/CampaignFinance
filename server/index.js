const express = require('express')
const bodyParser = require('body-parser')
const { sql } = require('slonik')

const { searchContributors, searchCommittees } = require('./lib/search')
const { getClient } = require('./db')
const app = express()
app.use(bodyParser.json())
const { PORT: port = 3001 } = process.env
const TRIGRAM_LIMIT = 0.6

const handleError = (error, res) => {
  console.error(error)
  res.status(500)
  const { NODE_ENV } = process.env
  const message =
    NODE_ENV === 'development'
      ? `unable to process request: ${error.message}`
      : 'unable to process request'
  res.send({ error: message })
}

const api = express.Router()
api.use(bodyParser.json())
api.get('/search/contributors/:name', async (req, res) => {
  try {
    const { name } = req.params
    const { offset = 0, limit = 50 } = req.query
    const decodedName = decodeURIComponent(name)

    const contributors = await searchContributors(
      decodedName,
      offset,
      limit,
      TRIGRAM_LIMIT
    )
    return res.send(contributors)
  } catch (error) {
    handleError(error, res)
  }
})

api.get('/search/candidates/:name', async (req, res) => {
  try {
    const { name } = req.params
    const { offset = 0, limit = 50 } = req.query
    const decodedName = decodeURIComponent(name)

    const committees = await searchCommittees(
      decodedName,
      offset,
      limit,
      TRIGRAM_LIMIT
    )
    return res.send(committees)
  } catch (error) {
    handleError(error, res)
  }
})

api.get('/candidate/:ncsbeID', async (req, res) => {
  let client = null
  try {
    let { ncsbeID = '' } = req.params
    const { limit = 50, offset = 0 } = req.query
    ncsbeID = decodeURIComponent(ncsbeID)
    if (!ncsbeID) {
      res.status(500)
      return res.send({
        error: 'empty ncsbeID',
      })
    }

    client = await getClient()
    const contributions = await client.query(
      `select *, count(*) over() as full_count from committees
      join contributions c on committees.sboe_id = c.committee_sboe_id
      where upper(committees.sboe_id) = upper($1)
      order by c.date_occurred asc
      limit $2
      offset $3
      `,
      [ncsbeID, limit, offset]
    )
    return res.send({
      data: contributions.rows,
      count:
        contributions.rows.length > 0 ? contributions.rows[0].full_count : 0,
    })
  } catch (error) {
    handleError(error, res)
  } finally {
    if (client !== null) {
      client.release()
    }
  }
})

api.get('/contributors/:contributorId/contributions', async (req, res) => {
  let client = null
  try {
    const { contributorId } = req.params
    const { limit = 50, offset = 0 } = req.query
    client = await getClient()
    const contributions = await client.query(
      `select *, count(*) over () as full_count from contributions
      where contributor_id = $1
      order by contributions.date_occurred asc
      limit $2
      offset $3
      `,
      [contributorId, limit, offset]
    )
    return res.send({
      data: contributions.rows,
      count:
        contributions.rows.length > 0 ? contributions.rows[0].full_count : 0,
    })
  } catch (error) {
    handleError(error, res)
  } finally {
    if (client !== null) {
      client.release()
    }
  }
})

api.get('/zipcodes/contributions', async (req, res) => {
  let client = null
  try {
    const { year, candidateName, office, committeeName } = req.query
    const decodedName = decodeURIComponent(name)
    const decodedCandName = decodeURIComponent(candidateName)
    const decodedOffice = decodeURIComponent(office)
    const decodedCommName = decodeURIComponent(committeeName)
    client = await getClient()

    const conditions = ['TRUE'][
      // eslint-disable-next-line no-sequences
      (year, name)
    ].forEach((item) => {
      if (item !== undefined) {
        conditions.push(item)
      }
    })

    const booleanExpressions = [sql`TRUE`]
    if (year !== undefined) {
      booleanExpressions.push(
        sql`date_part('year', to_date(contributions.date_occurred, 'MM/DD/YY')) = ${year}`
      )
    }
    const whereSqlToken = sql.join(booleanExpressions, 'AND')

    let query = `
      select
        substr(contributors.zip_code, 1, 5) as zipcode,
        sum(contributions.amount) as dollars_contributed,
        count(contributions)::integer as number_of_contributions,
        round(sum(contributions.amount)/count(contributions)) as average_contribution_amount
      from contributors
      inner join contributions
      on contributors.id = contributions.contributor_id
      where ${whereSqlToken}
      group by zipcode
      order by zipcode
    `
    console.log(query)
    const zipsByContributions = await client.query(query)
    return res.send({
      data: zipsByContributions.rows,
    })
  } catch (error) {
    handleError(error, res)
  } finally {
    if (client !== null) {
      client.release()
    }
  }
})

app.use('/api', api)
app.get('/status', (req, res) => res.send({ status: 'online' }))
app.listen(port, () => {
  console.log(`app listening on port ${port}`)
})
