package org.dayweave.mobile;

import org.junit.Test;
import static org.junit.Assert.*;

public class SyncEndpointTest {
    @Test public void preservesOrderAndRetriesFromFirstAddressEachTime() throws Exception {
        java.util.List<String> endpoints=SyncEndpoint.parseList(null,java.util.Arrays.asList("https://sync.example.com/dayweave","http://192.168.31.32:49732"));
        java.util.List<String> calls=new java.util.ArrayList<>();
        for(int round=0;round<2;round++) {
            assertEquals(endpoints.get(1),SyncEndpoint.first(endpoints,address->{calls.add(address);if(address.equals(endpoints.get(0)))throw new java.io.IOException("offline");return address;}));
        }
        assertEquals(java.util.Arrays.asList(endpoints.get(0),endpoints.get(1),endpoints.get(0),endpoints.get(1)),calls);
        assertEquals(java.util.Collections.singletonList("http://192.168.31.32:49732"),SyncEndpoint.parseList("http://192.168.31.32:49732",null));
    }
    @Test public void rejectsInvalidListsAndReportsAllAddressFailure() throws Exception {
        try {SyncEndpoint.parseList(null,java.util.Collections.emptyList());fail();}catch(IllegalArgumentException expected){}
        try {SyncEndpoint.parseList(null,java.util.Arrays.asList("https://sync.example.com","http://8.8.8.8"));fail();}catch(IllegalArgumentException expected){}
        try {SyncEndpoint.first(java.util.Arrays.asList("first","second"),address->{throw new java.io.IOException(address);});fail();}catch(java.io.IOException expected){assertEquals("second",expected.getMessage());}
    }
    @Test public void supportsHttpsPathsAndLegacyLan() throws Exception {
        assertEquals("https://sync.example.com/dayweave", SyncEndpoint.parse("https://sync.example.com/dayweave/"));
        assertEquals("https://sync.example.com:63573", SyncEndpoint.parse("https://sync.example.com:63573/"));
        assertEquals("http://192.168.31.32:49732", SyncEndpoint.parse("http://192.168.31.32:49732"));
    }
    @Test public void rejectsUnsafeEndpoints() {
        for (String address : new String[]{"http://8.8.8.8", "http://example.com", "http://192.168.1.1/path", "https://user:password@example.com", "https://example.com/?token=secret", "https://example.com/#fragment", "https://example.com/a/../b", "https://example.com/%2fprivate", "https://example.com:99999"}) {
            try { SyncEndpoint.parse(address); fail(address); }
            catch (Exception expected) { }
        }
    }
}
