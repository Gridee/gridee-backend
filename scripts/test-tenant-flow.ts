import * as dotenv from 'dotenv';
dotenv.config();

import { db } from '../src/db';
import { redis } from '../src/redis';
import { authController } from '../src/controllers/authController';
import { Request, Response } from 'express';

async function runIntegrationTest() {
  console.log('🚀 Setting up Test Property and Landlord...');

  try {
    // 1. Ensure we have a landlord
    let landlord = await db('users').where({ role: 'landlord' }).first();
    if (!landlord) {
      console.log('Creating a test landlord...');
      [landlord] = await db('users').insert({
        name: 'Test Landlord',
        phone: '+2348148915475',
        role: 'landlord'
      }).returning('*');
    }

    // 2. Ensure we have a property linked to this landlord
    let property = await db('properties').where({ code: 'GRD-TEST-0001' }).first();
    if (!property) {
      console.log('Creating a test property...');
      [property] = await db('properties').insert({
        landlord_id: landlord.id,
        code: 'GRD-TEST-0001',
        label: 'Test Apartment',
        address: '123 Test St',
        state: 'TEST',
        status: 'ACTIVE'
      }).returning('*');
    }

    console.log(' Setup Complete!');
    console.log(`Property Code: ${property.code}`);
    console.log(`Landlord Phone: ${landlord.phone}`);

  } catch (error) {
    console.error(' Setup failed:', error);
  } finally {
    await redis.quit();
    await db.destroy();
  }
}

runIntegrationTest();
